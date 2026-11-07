// The scenarios a stories file declares, read from its source with the project's own Storybook
// (storybook/internal/csf-tools): the meta's `parameters.spec`, and each export's `scenario({...})`
// call, wherever it sits (inside a factory call, spread, or alone). Nothing is executed.
import { createRequire } from "node:module";
import { join } from "node:path";

export function csfTools(projectDir) {
  const need = createRequire(join(projectDir, "package.json"));
  try { return need("storybook/internal/csf-tools"); } catch { throw new Error(`storybook (8.3 or later) is not installed in ${projectDir}; story-spec reads stories with its csf-tools`); }
}

// A literal's value: strings, numbers, booleans, arrays and objects of those, and template
// literals and identifiers whose parts `env` binds (a factory's parameters at one call);
// anything else is undefined (a reference, a call: not words).
export function literal(node, env = {}) {
  if (!node) return undefined;
  switch (node.type) {
    case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": return node.value;
    case "Identifier": return env[node.name];
    case "TemplateLiteral": {
      let out = "";
      for (const [i, q] of node.quasis.entries()) {
        out += q.value.cooked;
        if (i < node.expressions.length) { const v = literal(node.expressions[i], env); if (v === undefined) return undefined; out += String(v); }
      }
      return out;
    }
    case "ArrayExpression": return node.elements.map((e) => literal(e, env));
    case "ObjectExpression": {
      const out = {};
      for (const p of node.properties) {
        if (p.type !== "ObjectProperty") continue;
        const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : null;
        if (key != null) out[key] = literal(p.value, env);
      }
      return out;
    }
    case "TSAsExpression": case "TSSatisfiesExpression": case "ParenthesizedExpression": return literal(node.expression, env);
    default: return undefined;
  }
}

// A function declared at the top of the file: `const f = (a, b) => …`, `function f(a, b) {…}`.
function declared(program, name) {
  for (const s of program.body) {
    const st = s.type === "ExportNamedDeclaration" ? s.declaration : s;
    if (st?.type === "FunctionDeclaration" && st.id?.name === name) return st;
    if (st?.type === "VariableDeclaration") for (const d of st.declarations) if (d.id.type === "Identifier" && d.id.name === name && d.init && /Function/.test(d.init.type)) return d.init;
  }
  return null;
}

// The `scenario(...)` call behind an export, with the bindings it reads: the call itself, or,
// when the export calls a factory of the file's own (`export const A = restores('pointercancel')`),
// the call inside that factory with its parameters bound to the literal arguments. One level.
function scenarioCall(init, name, program) {
  const direct = findCall(init, name);
  if (direct) return { call: direct, env: {} };
  const outer = init?.type === "CallExpression" && init.callee.type === "Identifier" ? init : null;
  const factory = outer && declared(program, outer.callee.name);
  if (!factory) return null;
  const inner = findCall(factory.body, name, 0, true);
  if (!inner) return null;
  const env = {};
  factory.params.forEach((p, i) => { if (p.type === "Identifier") env[p.name] = literal(outer.arguments[i]); else if (p.type === "AssignmentPattern" && p.left.type === "Identifier") env[p.left.name] = outer.arguments[i] ? literal(outer.arguments[i]) : literal(p.right); });
  return { call: inner, env };
}

// The first call to `name` under `node`, depth first, not descending into function bodies
// (a scenario's act or check may call another scenario's helpers).
function findCall(node, name, depth = 0, intoFunctions = false) {
  if (!node || typeof node !== "object" || depth > 40) return null;
  if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === name) return node;
  if (!intoFunctions && /Function/.test(node.type ?? "")) return null;
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const x of v) { const hit = findCall(x, name, depth + 1, intoFunctions); if (hit) return hit; } }
    else if (v && typeof v === "object" && v.type) { const hit = findCall(v, name, depth + 1, intoFunctions); if (hit) return hit; }
  }
  return null;
}

// What the file imports `scenario` as, from story-spec (or a path ending in story-spec).
function localName(program) {
  for (const s of program.body) {
    if (s.type !== "ImportDeclaration" || !/(^|\/)story-spec(\.js)?$/.test(s.source.value)) continue;
    for (const sp of s.specifiers) if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "scenario") return sp.local.name;
  }
  return null;
}

// Every scenario in one stories file, each with the meta's spec fields beside its own.
export function scenariosIn(code, file, tools) {
  const csf = tools.loadCsf(code, { fileName: file, makeTitle: (t) => t ?? "" }).parse();
  const program = csf._ast.program;
  const name = localName(program);
  if (!name) return [];
  const spec = literal(csf._metaAnnotations.parameters)?.spec ?? {};
  const out = [];
  for (const [exportName, declaration] of Object.entries(csf._storyExports)) {
    const found = scenarioCall(declaration.type === "VariableDeclarator" ? declaration.init : declaration, name, program);
    if (!found) continue;
    const words = literal(found.call.arguments[0], found.env);
    if (!words || typeof words !== "object") continue;
    const { act, check, ...rest } = words;
    out.push({ file, exportName, title: csf._meta?.title ?? null, capability: spec.capability ?? null, fileRequirement: spec.requirement ?? null, fileShall: spec.shall ?? null, purpose: spec.purpose ?? null, ...rest });
  }
  return out;
}
