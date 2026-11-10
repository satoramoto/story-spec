import { test } from "node:test";
import assert from "node:assert/strict";
import { humanize, capabilities, parseSpec, renderSpec, renderDelta, diff, retirements } from "../lib/spec.js";
import { scenario } from "../index.js";

test("export names read as scenario names", () => {
  assert.equal(humanize("DragSeeks"), "Drag seeks");
  assert.equal(humanize("arrowKeysMoveTheHead"), "Arrow keys move the head");
  assert.equal(humanize("EscapeCancelsADrag"), "Escape cancels a drag");
  assert.equal(humanize("ARIAValueNow"), "ARIA value now");
});

const found = [
  { file: "a.stories.tsx", exportName: "PressSeeks", capability: "seek-bar", fileRequirement: "Seeking", fileShall: "The bar SHALL seek.", purpose: "Seeking.", when: "pressed", then: "seeks" },
  { file: "a.stories.tsx", exportName: "Disabled", capability: "seek-bar", fileRequirement: "Seeking", fileShall: "The bar SHALL seek.", requirement: "Inert states", shall: "The bar MUST be inert when disabled.", given: "disabled", when: "pressed", then: "nothing", and: ["aria-disabled"] },
];

test("scenarios group into capabilities and requirements, a scenario's own requirement winning over the file's", () => {
  const { capabilities: caps, problems } = capabilities(found);
  assert.deepEqual(problems, []);
  const cap = caps["seek-bar"];
  assert.equal(cap.purpose, "Seeking.");
  assert.deepEqual(cap.requirements.map((r) => r.name), ["Seeking", "Inert states"]);
  assert.equal(cap.requirements[1].text, "The bar MUST be inert when disabled.");
  assert.deepEqual(cap.requirements[1].scenarios[0].lines, [{ kw: "GIVEN", text: "disabled" }, { kw: "WHEN", text: "pressed" }, { kw: "THEN", text: "nothing" }, { kw: "AND", text: "aria-disabled" }]);
  assert.equal(cap.requirements[0].scenarios[0].name, "Press seeks");
});

test("missing words are problems, not silent gaps", () => {
  const { problems } = capabilities([{ file: "x", exportName: "A", when: "w", then: "t" }, { file: "x", exportName: "B", capability: "c", fileRequirement: "R", when: "w", then: "t" }, { file: "x", exportName: "C", capability: "c", fileRequirement: "Q", fileShall: "It does things.", when: "w", then: "t" }]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /no capability/);
  assert.match(problems[1], /no SHALL text/);
  assert.match(problems[2], /must contain SHALL or MUST/);
});

test("a rendered spec parses back to the same requirements, and a delta carries its sections", () => {
  const { capabilities: caps } = capabilities(found);
  const text = renderSpec("seek-bar", caps["seek-bar"]);
  const back = parseSpec(text);
  assert.equal(back.title, "seek-bar Specification");
  assert.equal(back.purpose, "Seeking.");
  assert.deepEqual(back.requirements.map((r) => [r.name, r.section, r.text, r.scenarios.length]), [["Seeking", "Requirements", "The bar SHALL seek.", 1], ["Inert states", "Requirements", "The bar MUST be inert when disabled.", 1]]);
  assert.deepEqual(back.requirements[1].scenarios[0].lines, caps["seek-bar"].requirements[1].scenarios[0].lines);
  const delta = parseSpec(renderDelta("seek-bar", { purpose: "P", added: [caps["seek-bar"].requirements[0]], modified: [caps["seek-bar"].requirements[1]] }));
  assert.deepEqual(delta.requirements.map((r) => [r.name, r.section]), [["Seeking", "ADDED"], ["Inert states", "MODIFIED"]]);
});

test("the diff adds new requirements, modifies changed ones in full, and reports uncovered ones", () => {
  const { capabilities: caps } = capabilities(found);
  const cap = caps["seek-bar"];
  assert.deepEqual(diff(null, cap).added.map((r) => r.name), ["Seeking", "Inert states"]);
  const main = parseSpec(renderSpec("seek-bar", { purpose: "P", requirements: [cap.requirements[0], { name: "Gone", text: "It SHALL go.", scenarios: [] }] }));
  const d = diff(main, cap);
  assert.deepEqual(d.unchanged.map((r) => r.name), ["Seeking"]);
  assert.deepEqual(d.added.map((r) => r.name), ["Inert states"]);
  assert.deepEqual(d.missing.map((r) => r.name), ["Gone"]);
  const changed = { ...cap, requirements: [{ ...cap.requirements[0], text: "The bar SHALL seek precisely." }, cap.requirements[1]] };
  assert.deepEqual(diff(main, changed).modified.map((r) => r.name), ["Seeking"]);
});

test("scenario() keeps the base story, adds the words and a stepped play", async () => {
  const base = { args: { a: 1 }, parameters: { svelte: { x: 1 }, docs: { description: { component: "C" } } }, play: async () => { ran.push("base"); } };
  const ran = [];
  const s = scenario({ given: "g", when: "w", then: "t", and: ["x"], act: () => { ran.push("act"); }, check: () => { ran.push("check"); } }, base);
  assert.deepEqual(s.args, { a: 1 });
  assert.deepEqual(s.parameters.svelte, { x: 1 });
  assert.deepEqual(s.parameters.scenario, { given: "g", when: "w", then: "t", and: ["x"] });
  assert.equal(s.parameters.docs.description.component, "C");
  assert.equal(s.parameters.docs.description.story, "**Given** g\n\n**When** w\n\n**Then** t\n\n**And** x");
  assert.deepEqual(s.tags, ["scenario"]);
  const steps = [];
  await s.play({ step: async (label, fn) => { steps.push(label); await fn({}); } });
  assert.deepEqual(steps, ["Given g", "When w", "Then t, and x"]);
  assert.deepEqual(ran, ["base", "act", "check"]);
  assert.throws(() => scenario({ when: "w" }), /then/);
});

const retire = (over) => ({ file: "a.stories.tsx", capability: "seek-bar", requirement: null, reason: null, migration: null, renamedTo: null, ...over });

test("a retired requirement is removed with the person's reason and migration; an unretired one is only reported", () => {
  const { capabilities: caps } = capabilities(found);
  const cap = caps["seek-bar"];
  const main = parseSpec(renderSpec("seek-bar", { purpose: "P", requirements: [...cap.requirements, { name: "Gone", text: "It SHALL go.", scenarios: [] }, { name: "Stale", text: "It SHALL stay.", scenarios: [] }] }));
  const { retires, problems } = retirements([retire({ requirement: "Gone", reason: "Merged into Seeking.", migration: "Read Seeking." }), retire({ requirement: "Other", capability: "elsewhere", reason: "r", migration: "m" })], "seek-bar");
  assert.deepEqual(problems, []);
  const d = diff(main, cap, retires);
  assert.deepEqual(d.removed, [{ name: "Gone", reason: "Merged into Seeking.", migration: "Read Seeking." }]);
  assert.deepEqual(d.missing.map((r) => r.name), ["Stale"]);
  assert.deepEqual([d.added, d.modified, d.problems], [[], [], []]);
  const text = renderDelta("seek-bar", d);
  assert.match(text, /## REMOVED Requirements\n\n### Requirement: Gone\n\n\*\*Reason\*\*: Merged into Seeking\.\n\n\*\*Migration\*\*: Read Seeking\.\n/);
  assert.deepEqual(parseSpec(text).requirements.map((r) => [r.name, r.section]), [["Gone", "REMOVED"]]);
});

test("a rename carries the requirement to its new name, modified only if it changed too", () => {
  const { capabilities: caps } = capabilities(found);
  const cap = caps["seek-bar"];
  const old = { ...cap.requirements[0], name: "Scrubbing" };
  const main = parseSpec(renderSpec("seek-bar", { purpose: "P", requirements: [old, cap.requirements[1]] }));
  const { retires } = retirements([retire({ requirement: "Scrubbing", renamedTo: "Seeking" })], "seek-bar");
  const d = diff(main, cap, retires);
  assert.deepEqual(d.renamed, [{ from: "Scrubbing", to: "Seeking" }]);
  assert.deepEqual([d.added.length, d.modified.length, d.missing.length], [0, 0, 0]);
  assert.match(renderDelta("seek-bar", d), /## RENAMED Requirements\n\n- FROM: `### Requirement: Scrubbing`\n- TO: `### Requirement: Seeking`\n/);
  const reworded = parseSpec(renderSpec("seek-bar", { purpose: "P", requirements: [{ ...old, text: "The bar SHALL scrub." }, cap.requirements[1]] }));
  const both = diff(reworded, cap, retires);
  assert.deepEqual([both.renamed.length, both.modified.map((r) => r.name), both.added.length], [1, ["Seeking"], 0]);
});

test("a spent retirement says nothing, and an unsound one is a problem", () => {
  const { capabilities: caps } = capabilities(found);
  const cap = caps["seek-bar"];
  const main = parseSpec(renderSpec("seek-bar", cap));
  // The spec no longer has it: the declaration can stay in the stories and nothing is written.
  const spent = diff(main, cap, retirements([retire({ requirement: "Gone", reason: "r", migration: "m" })], "seek-bar").retires);
  assert.deepEqual([spent.removed, spent.renamed, spent.problems, spent.missing], [[], [], [], []]);
  assert.match(diff(main, cap, [retire({ requirement: "Seeking", reason: "r", migration: "m" })]).problems[0], /still cover/);
  assert.match(diff(parseSpec(renderSpec("seek-bar", { ...cap, requirements: [...cap.requirements, { name: "Old", text: "It SHALL.", scenarios: [] }] })), cap, [retire({ requirement: "Old", renamedTo: "Nowhere" })]).problems[0], /no story covers/);
  const bad = retirements([retire({ requirement: "A" }), retire({ requirement: "B", reason: "r" }), retire({ requirement: "C", renamedTo: "D", reason: "r" }), retire({})], "seek-bar");
  assert.equal(bad.retires.length, 0);
  assert.equal(bad.problems.length, 4);
});
