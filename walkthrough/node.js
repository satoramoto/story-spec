/** Filesystem and source identity support. Kept outside the browser-safe contract entry. */
import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateWalkthrough } from './index.js';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Read the PNG signature and IHDR, rejecting truncated and non-PNG assets. */
export function pngDimensions(bytes) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('invalid PNG header');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Verify a completed bundle and every image against independently supplied source identities. */
export async function readWalkthrough(directory, expectedSources) {
  if (!expectedSources) throw new Error(`Walkthrough ${directory}: expected sources are required`);
  const root = await realpath(directory);
  const manifest = await realpath(resolve(root, 'manifest.json'));
  if (!manifest.startsWith(root + sep)) throw new Error(`Walkthrough ${directory}: manifest escapes bundle`);
  const bundle = validateWalkthrough(JSON.parse(await readFile(manifest, 'utf8')), expectedSources);
  for (const step of bundle.steps) {
    try {
      const file = await realpath(resolve(root, step.image));
      if (!file.startsWith(root + sep)) throw new Error('image escapes bundle');
      if (!(await stat(file)).isFile()) throw new Error('image is not a file');
      const bytes = await readFile(file);
      if (sha256(bytes) !== step.digest) throw new Error('image digest changed');
      const dimensions = pngDimensions(bytes);
      if (dimensions.width !== step.width || dimensions.height !== step.height) throw new Error('image dimensions changed');
    } catch (error) {
      throw new Error(`Walkthrough ${bundle.task.id}: ${step.image}: ${error.message}`, { cause: error });
    }
  }
  return bundle;
}

/** Hash explicitly selected source inputs, including uncommitted content but never generated output. */
export async function sourceIdentity(root, inputs, settings = {}) {
  const base = await realpath(root);
  const files = [];
  async function visit(name) {
    const file = await realpath(resolve(base, name));
    if (!file.startsWith(base + sep)) throw new Error(`Source input escapes repository: ${name}`);
    const info = await stat(file);
    if (info.isDirectory()) {
      for (const entry of (await readdir(file)).sort()) await visit(relative(base, resolve(file, entry)));
    } else if (info.isFile()) files.push(file);
  }
  for (const input of inputs) await visit(input);
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    hash.update(relative(base, file)).update('\0').update(await readFile(file)).update('\0');
  }
  hash.update(JSON.stringify(settings));
  const git = args => execFileSync('git', args, { cwd: base, encoding: 'utf8' }).trim();
  const origin = git(['remote', 'get-url', 'origin']);
  const repository = origin.replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/').replace(/\.git$/, '');
  const revision = git(['rev-parse', 'HEAD']);
  return { repository, revision, digest: hash.digest('hex'), dirty: git(['status', '--porcelain', '--', ...inputs]).length > 0, url: `${repository}/tree/${revision}` };
}
