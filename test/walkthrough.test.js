import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateWalkthrough, validateWalkthroughs } from '../walkthrough/index.js';
import { readWalkthrough, sha256, pngDimensions } from '../walkthrough/node.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');
const sources = { product: { repository: 'https://example.com/product', revision: 'a'.repeat(40), digest: 'b'.repeat(64), dirty: false, url: 'https://example.com/product/tree/main' } };
function fixture(adapter = 'web') {
  return {
    version: 1, task: { id: 'find-documentation', scenario: 'site-documentation--find-a-concept', title: 'Find documentation', chapter: 'Getting started', order: 1 }, sources: structuredClone(sources),
    run: { status: 'completed', adapter, renderer: adapter === 'web' ? 'Chromium' : 'lavapipe', theme: 'console', viewport: { width: 1280, height: 800 }, scale: 1, required: ['start'] },
    steps: [{ id: 'start', caption: 'Search for a topic.', alt: 'Documentation search field.', image: 'start.png', digest: sha256(png), ...pngDimensions(png), callouts: [{ number: 1, rect: [0, 0, 1, 1], text: 'Search field' }] }],
  };
}

test('web and native bundles share the contract', () => {
  for (const adapter of ['web', 'native']) assert.equal(validateWalkthrough(fixture(adapter), sources).run.adapter, adapter);
});

test('incomplete, stale and malformed evidence cannot validate', () => {
  const cases = [
    b => b.version = 2,
    b => b.run.status = 'failed',
    b => b.run.required.push('result'),
    b => b.sources.product.digest = 'c'.repeat(64),
    b => b.steps.push(structuredClone(b.steps[0])),
    b => b.steps[0].callouts[0].rect = [0.9, 0, 0.2, 1],
    b => b.steps[0].callouts[0].rect = [0, 0, 0, 1],
    b => b.steps[0].callouts.push(structuredClone(b.steps[0].callouts[0])),
    b => b.steps[0].image = '../outside.png',
    b => b.steps[0].image = '/outside.png',
    b => b.steps[0].alt = ' ',
  ];
  for (const change of cases) {
    const bundle = fixture(); change(bundle);
    assert.throws(() => validateWalkthrough(bundle, sources), /Walkthrough find-documentation:/);
  }
  assert.throws(() => validateWalkthroughs([fixture(), fixture()]), /duplicate task/);
});

test('file validation requires current sources, intact images and contained real paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'story-spec-walkthrough-'));
  const outside = await mkdtemp(join(tmpdir(), 'story-spec-outside-'));
  try {
    await writeFile(join(root, 'manifest.json'), JSON.stringify(fixture()));
    await writeFile(join(root, 'start.png'), png);
    assert.equal((await readWalkthrough(root, sources)).task.id, 'find-documentation');
    await assert.rejects(readWalkthrough(root), /expected sources/);
    await writeFile(join(root, 'start.png'), Buffer.concat([png, Buffer.from('changed')]));
    await assert.rejects(readWalkthrough(root, sources), /find-documentation.*digest/);
    await rm(join(root, 'start.png'));
    await assert.rejects(readWalkthrough(root, sources), /find-documentation.*start.png/);
    await writeFile(join(outside, 'start.png'), png);
    await symlink(join(outside, 'start.png'), join(root, 'start.png'));
    await assert.rejects(readWalkthrough(root, sources), /find-documentation.*escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
