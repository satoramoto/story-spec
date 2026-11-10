#!/usr/bin/env node
// story-spec: the stories are the spec.
//   story-spec list [--dir <folder>]...                 the scenarios the stories declare, by capability and requirement
//   story-spec sync --change <name> [--dir <folder>]... write openspec/changes/<name>/specs/<capability>/spec.md for every
//                                                        capability whose stories differ from openspec/specs/<capability>/spec.md
//   story-spec sync --specs [--dir <folder>]...         write openspec/specs/<capability>/spec.md directly (bootstrapping,
//                                                        or a project that keeps no changes)
//   --check   with sync: write nothing; exit 1 when a file would change (the drift guard for CI)
// A requirement the spec has and no story covers is reported, never removed, unless a stories file retires it:
//   parameters.spec.retires: [{ requirement, reason, migration } | { requirement, renamedTo }], each for the file's
//   capability or its own `capability`. `sync --change` then writes it as REMOVED or RENAMED.
//   --root <project>   the project (default: the current folder); --dir is relative to it (default: src)
// Where openspec/ is comes from OpenSpec itself (`openspec context --json`, run in the project), so a project that
// plans in a store (openspec/config.yaml with `store: <id>`) writes there; a repo-local project writes beside its code.
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { csfTools, scenariosIn, retiresIn } from "../lib/csf.js";
import { capabilities, parseSpec, renderSpec, renderDelta, diff, retirements } from "../lib/spec.js";

const args = process.argv.slice(2);
const verb = args.find((a) => !a.startsWith("--"));
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const flags = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const has = (name) => args.includes(name);
const root = resolve(flag("--root") ?? ".");
const dirs = (flags("--dir").length ? flags("--dir") : ["src"]).map((d) => resolve(root, d));
if (!verb || !["list", "sync"].includes(verb) || has("--help")) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(verb ? 0 : 2); }

function* storyFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* storyFiles(path);
    else if (/\.stories\.[jt]sx?$/.test(entry.name)) yield path;
  }
}

const tools = csfTools(root);
const scenarios = [];
const retired = [];
for (const dir of dirs) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`no folder ${dir}`); process.exit(2); }
  for (const file of storyFiles(dir)) {
    const rel = relative(root, file);
    try { const code = readFileSync(file, "utf8"); scenarios.push(...scenariosIn(code, rel, tools)); retired.push(...retiresIn(code, rel, tools)); }
    catch (error) { console.error(`${rel}: ${error.message}`); }
  }
}
const { capabilities: caps, problems } = capabilities(scenarios);
// A capability can be named by a retirement alone: every requirement of it is leaving.
for (const r of retired) { if (!r.capability) problems.push(`${r.file}: a retires entry has no capability (parameters.spec.capability on the meta, or "capability" in the entry)`); else caps[r.capability] ??= { purpose: null, requirements: [] }; }
const retiresOf = {};
for (const name of Object.keys(caps)) { const r = retirements(retired, name); retiresOf[name] = r.retires; problems.push(...r.problems); }
for (const p of problems) console.error(`problem: ${p}`);

if (verb === "list") {
  for (const [name, cap] of Object.entries(caps)) {
    console.log(`${name}${cap.purpose ? `: ${cap.purpose}` : ""}`);
    for (const r of cap.requirements) {
      console.log(`  ${r.name}${r.text ? "" : "  (no SHALL text)"}`);
      for (const s of r.scenarios) console.log(`    ${s.name}  ← ${s.file} ${s.exportName}`);
    }
  }
  console.log(`\n${scenarios.length} scenarios in ${Object.values(caps).reduce((n, c) => n + c.requirements.length, 0)} requirements, ${Object.keys(caps).length} capabilities`);
  process.exit(problems.length ? 1 : 0);
}

if (problems.length) { console.error("nothing written: fix the problems above"); process.exit(1); }
const change = flag("--change");
const toSpecs = has("--specs");
const check = has("--check");
if (!change && !toSpecs) { console.error("sync needs --change <name> or --specs"); process.exit(2); }
const specRoot = openspecRoot(root);
if (!specRoot) { console.error(`no OpenSpec root for ${root}: run \`openspec init\` there, or point its openspec/config.yaml at a store`); process.exit(2); }
if (specRoot !== root) console.log(`planning in ${specRoot}`);
let drift = 0;
let unsound = 0;
function openspecRoot(project) {
  try {
    const out = execFileSync("openspec", ["context", "--json"], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const path = JSON.parse(out)?.root?.path;
    if (path && existsSync(join(path, "openspec"))) return path;
  } catch {}
  return existsSync(join(project, "openspec", "specs")) || existsSync(join(project, "openspec", "changes")) ? project : null;
}
function put(path, text) {
  const was = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (was === text) { console.log(`unchanged  ${relative(specRoot, path)}`); return; }
  if (check) { console.log(`${was == null ? "missing   " : "differs   "} ${relative(specRoot, path)}`); drift++; return; }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  console.log(`${was == null ? "wrote     " : "updated   "} ${relative(specRoot, path)}`);
}
const deltas = [];
for (const [name, cap] of Object.entries(caps)) {
  const mainPath = join(specRoot, "openspec", "specs", name, "spec.md");
  const main = existsSync(mainPath) ? parseSpec(readFileSync(mainPath, "utf8")) : null;
  // The stories' purpose is the spec's; a delta can't carry a changed one, so it lands with `sync --specs`.
  if (toSpecs) { if (cap.requirements.length) put(mainPath, renderSpec(name, { ...cap, purpose: cap.purpose ?? main?.purpose })); continue; }
  const d = diff(main, cap, retiresOf[name]);
  for (const p of d.problems) { console.error(`problem: ${name}: ${p}`); unsound++; }
  for (const r of d.missing) console.error(`note: ${name}: requirement "${r.name}" is in the spec but no story covers it (not removed: retire it in a stories file's parameters.spec.retires to remove or rename it)`);
  if (!d.added.length && !d.modified.length && !d.removed.length && !d.renamed.length) { console.log(`no delta   ${name}: the stories match ${relative(specRoot, mainPath)}`); continue; }
  deltas.push([join(specRoot, "openspec", "changes", change, "specs", name, "spec.md"), renderDelta(name, { purpose: main ? null : cap.purpose, added: d.added, modified: d.modified, removed: d.removed, renamed: d.renamed })]);
}
// Nothing is written while a retirement is unsound: a half-written change would hide it.
if (unsound) { console.error("nothing written: fix the problems above"); process.exit(1); }
for (const [path, text] of deltas) put(path, text);
if (drift) { console.error(`${drift} file(s) would change: run story-spec sync`); process.exit(1); }
