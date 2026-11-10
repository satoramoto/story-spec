import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario, captureCheckpoint } from '../index.js';
import { scenariosIn, csfTools } from '../lib/csf.js';
import { capabilities, renderSpec } from '../lib/spec.js';

const declaration = { id: 'search', title: 'Search', chapter: 'Start', order: 1, checkpoints: [{ id: 'result', caption: 'Read the result.', alt: 'Search result.' }] };

test('checkpoints await the sink inside the existing act/check order', async () => {
  const events = [];
  const story = scenario({
    when: 'searching', then: 'results appear', walkthrough: declaration,
    act: async context => { events.push('act'); await captureCheckpoint(context, 'result'); events.push('after'); },
    check: () => { events.push('check'); },
  });
  const context = {
    id: 'search', parameters: story.parameters,
    canvasElement: { ownerDocument: { defaultView: { __STORY_SPEC_CAPTURE__: async data => {
      assert.equal(data.point.id, 'result');
      await Promise.resolve(); events.push('captured');
    } } } },
  };
  context.step = async (_label, fn) => fn(context);
  await story.play(context);
  assert.deepEqual(events, ['act', 'captured', 'after', 'check']);
  await assert.rejects(captureCheckpoint(context, 'unknown'), /undeclared checkpoint/);
});

test('opted-in plays finish normally with no adapter', async () => {
  let actions = 0, checks = 0;
  const story = scenario({ when: 'acting', then: 'checked', walkthrough: declaration,
    act: async context => { actions++; await captureCheckpoint(context, 'result'); }, check: () => { checks++; },
  });
  const context = { parameters: story.parameters, step: (_label, fn) => fn(context) };
  await story.play(context);
  assert.equal(actions, 1); assert.equal(checks, 1);
});

test('walkthrough declarations do not change extracted spec words or docs', () => {
  const source = metadata => `import { scenario } from 'story-spec';
    export default { title: 'Search', parameters: { spec: { capability: 'search', requirement: 'Search', shall: 'Search SHALL work.', purpose: 'Search works.' } } };
    export const Search = scenario({ when: 'searching', then: 'found', ${metadata} });`;
  const tools = csfTools(process.cwd());
  const extract = code => capabilities(scenariosIn(code, 'Search.stories.tsx', tools)).capabilities.search;
  assert.equal(renderSpec('search', extract(source(''))), renderSpec('search', extract(source(`walkthrough: ${JSON.stringify(declaration)}`))));
  assert.equal(scenario({ when: 'w', then: 't', walkthrough: declaration }).parameters.docs.description.story, scenario({ when: 'w', then: 't' }).parameters.docs.description.story);
});
