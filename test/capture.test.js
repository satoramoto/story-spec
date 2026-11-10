import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureStory } from '../walkthrough/capture.js';

test('timeout during browser context creation closes the late context and removes staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'walkthrough-timeout-'));
  let closed = 0;
  const browser = { newContext: async () => {
    await delay(30);
    return { close: async () => { closed++; }, newPage: () => { throw new Error('Cancelled context must not open a page'); } };
  } };
  try {
    await assert.rejects(captureStory({ browser, output: join(root, 'output'), timeout: 1 }), /timed out/);
    assert.equal(closed, 1);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
