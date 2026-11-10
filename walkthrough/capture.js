/** Capture one real Storybook play. The caller owns the browser/server; this function owns its context. */
import { mkdir, mkdtemp, writeFile, rename, rm, lstat, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { validateWalkthrough } from './index.js';
import { readWalkthrough, sha256, pngDimensions } from './node.js';
import { csfTools, scenariosIn } from '../lib/csf.js';

/** Storybook's static index cannot see helper-produced tags; match extracted declarations by export. */
export async function walkthroughStories(index, projectRoot) {
  const root = resolve(projectRoot);
  const tools = csfTools(root);
  const files = new Map();
  const selected = [];
  for (const entry of Object.values(index.entries)) {
    if (entry.type !== 'story') continue;
    const file = resolve(root, entry.importPath);
    if (!file.startsWith(root + sep)) throw new Error(`Story source escapes project: ${entry.importPath}`);
    if (!files.has(file)) {
      const code = await readFile(file, 'utf8');
      files.set(file, code.includes('story-spec') ? scenariosIn(code, file, tools) : []);
    }
    const declaration = files.get(file).find(story => story.exportName === entry.exportName && story.walkthrough);
    if (declaration) selected.push({ ...entry, walkthrough: declaration.walkthrough });
  }
  return selected;
}

export async function captureStory({ browser, url, storyId, sources, output, viewport = { width: 1280, height: 800 }, theme = 'textbook-console', timeout = 30000, args }) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Capture timeout must be positive');
  const destination = resolve(output);
  try {
    await lstat(destination);
    throw new Error(`Capture output already exists: ${destination}; use a fresh run directory`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(`${destination}.staging-`);
  let context, timer, declaration, cancelled = false;
  const steps = [];
  let captureError;
  const operation = async () => {
    context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    if (cancelled) {
      await context.close();
      throw new Error('Capture cancelled during context creation');
    }
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const stamp = await context.request.get(new URL('manual-build.json', url.endsWith('/') ? url : `${url}/`).href, { timeout });
    if (!stamp.ok()) throw new Error(`Walkthrough ${storyId}: missing Storybook build fingerprint; rebuild`);
    const builtSources = await stamp.json();
    for (const role of new Set([...Object.keys(sources), ...Object.keys(builtSources)])) {
      for (const field of ['repository', 'revision', 'digest', 'dirty']) {
        if (sources[role]?.[field] !== builtSources[role]?.[field]) throw new Error(`Walkthrough ${storyId}: stale Storybook source ${role}.${field}; rebuild`);
      }
    }
    await page.exposeBinding('__STORY_SPEC_CAPTURE__', async ({ frame }, data) => {
      try {
        if (frame !== page.mainFrame() || data.storyId !== storyId) throw new Error('Capture requested by a different story/frame');
        if (!declaration) declaration = data.declaration;
        if (JSON.stringify(data.declaration) !== JSON.stringify(declaration)) throw new Error('Walkthrough declaration changed during play');
        const expected = declaration.checkpoints[steps.length];
        if (!expected || JSON.stringify(expected) !== JSON.stringify(data.point)) throw new Error(`Unexpected checkpoint ${data.point.id}`);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.querySelectorAll('#storybook-root img')].map(image => image.decode()));
          await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
        await page.addStyleTag({ content: '#storybook-root *, #storybook-root *::before, #storybook-root *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
        const bytes = await page.locator('#storybook-root').screenshot({ animations: 'disabled', timeout });
        const image = `${expected.id}.png`;
        // Validate ids before using them as filenames.
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(expected.id)) throw new Error('Invalid checkpoint id');
        await writeFile(resolve(staging, image), bytes);
        steps.push({ ...expected, image, digest: sha256(bytes), ...pngDimensions(bytes) });
      } catch (error) { captureError = error; throw error; }
    });
    await page.addInitScript(() => {
      window.__walkthroughEvents = [];
      let channel;
      Object.defineProperty(window, '__STORYBOOK_ADDONS_CHANNEL__', { configurable: true,
        get: () => channel, set: value => {
          channel = value;
          for (const type of ['storyFinished', 'storyThrewException', 'storyErrored', 'playFunctionThrewException']) {
            channel.on(type, result => window.__walkthroughEvents.push({ type, status: result?.status, message: result?.message ?? result?.error?.message ?? '' }));
          }
        },
      });
    });
    const target = new URL('iframe.html', url.endsWith('/') ? url : `${url}/`);
    target.searchParams.set('id', storyId);
    target.searchParams.set('viewMode', 'story');
    target.searchParams.set('globals', `theme:${theme};mode:dark`);
    if (args) target.searchParams.set('args', args);
    await page.goto(target.href);
    await page.waitForFunction(() => window.__walkthroughEvents.some(event => event.type === 'storyFinished' || event.type !== 'storyFinished'), { timeout });
    const events = await page.evaluate(() => window.__walkthroughEvents);
    if (captureError) throw captureError;
    if (!events.some(event => event.type === 'storyFinished' && event.status === 'success') || events.some(event => event.type !== 'storyFinished')) throw new Error(`Story failed: ${JSON.stringify(events)}`);
    if (!declaration) throw new Error('No walkthrough checkpoints captured');
    const { id, title, chapter, order, checkpoints } = declaration;
    const bundle = validateWalkthrough({
      version: 1, task: { id, title, chapter, order, scenario: storyId }, sources,
      run: { status: 'completed', adapter: 'web', renderer: `Chromium ${browser.version()}`, theme, viewport, scale: 1, required: checkpoints.map(point => point.id) },
      steps,
    }, sources);
    await writeFile(resolve(staging, 'manifest.json'), JSON.stringify(bundle, null, 2) + '\n');
    await readWalkthrough(staging, sources);
    return bundle;
  };
  const running = operation();
  try {
    const bundle = await Promise.race([
      running,
      new Promise((_, reject) => { timer = setTimeout(() => { cancelled = true; reject(new Error(`Capture timed out after ${timeout}ms`)); }, timeout); }),
    ]);
    clearTimeout(timer);
    await context.close();
    // A unique destination is required; never overwrite or reuse last-known-good evidence.
    await rename(staging, destination);
    return { bundle, directory: destination };
  } catch (error) {
    error.captured = steps.map(step => step.id);
    error.taskId = declaration?.id ?? storyId;
    throw error;
  } finally {
    clearTimeout(timer);
    await context?.close();
    await running.catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}
