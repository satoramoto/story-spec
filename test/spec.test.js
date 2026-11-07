import { test } from "node:test";
import assert from "node:assert/strict";
import { humanize, capabilities, parseSpec, renderSpec, renderDelta, diff } from "../lib/spec.js";
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
