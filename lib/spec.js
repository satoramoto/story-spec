// OpenSpec's spec markdown, both ways: what a spec or delta file says, and what to write from the
// scenarios the stories declare. Pure.

// "DragSeeks" → "Drag seeks"; "arrowKeysMoveTheHead" → "Arrow keys move the head".
export function humanize(exportName) {
  const words = exportName.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().split(/\s+/);
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

// The scenarios the stories declare, grouped into capabilities and requirements:
// { [capability]: { purpose, requirements: [{ name, text, scenarios: [{ name, lines }] }] } }.
// A requirement's SHALL text is the first one declared for it; a scenario's name is its own or
// its export's, spaced out.
export function capabilities(scenarios) {
  const caps = {};
  const problems = [];
  for (const s of scenarios) {
    if (!s.capability) { problems.push(`${s.file}: ${s.exportName}: no capability (set parameters.spec.capability on the meta)`); continue; }
    const requirement = s.requirement ?? s.fileRequirement;
    if (!requirement) { problems.push(`${s.file}: ${s.exportName}: no requirement (parameters.spec.requirement on the meta, or "requirement" in the scenario)`); continue; }
    const cap = (caps[s.capability] ??= { purpose: null, requirements: [] });
    cap.purpose ??= s.purpose ?? null;
    let req = cap.requirements.find((r) => r.name === requirement);
    if (!req) { req = { name: requirement, text: null, scenarios: [] }; cap.requirements.push(req); }
    req.text ??= s.shall ?? (s.requirement ? null : s.fileShall) ?? null;
    const lines = [s.given && { kw: "GIVEN", text: s.given }, { kw: "WHEN", text: s.when }, { kw: "THEN", text: s.then }, ...(s.and ?? []).map((text) => ({ kw: "AND", text }))].filter(Boolean);
    const name = s.name ?? humanize(s.exportName);
    if (req.scenarios.some((x) => x.name === name)) problems.push(`${s.file}: ${s.exportName}: scenario "${name}" is declared twice under "${requirement}"`);
    req.scenarios.push({ name, lines, file: s.file, exportName: s.exportName });
  }
  for (const [name, cap] of Object.entries(caps)) for (const r of cap.requirements) {
    if (!r.text) problems.push(`${name}: requirement "${r.name}" has no SHALL text (parameters.spec.shall on the meta, or "shall" in one of its scenarios)`);
    else if (!/\b(SHALL|MUST)\b/.test(r.text)) problems.push(`${name}: requirement "${r.name}": its text must contain SHALL or MUST`);
  }
  return { capabilities: caps, problems };
}

// A spec or delta file: its title, purpose, and requirements with the section each sits in
// ("Requirements" in a spec; "ADDED", "MODIFIED", "REMOVED", "RENAMED" in a delta).
export function parseSpec(markdown) {
  const out = { title: null, purpose: null, requirements: [] };
  let section = null, req = null, scen = null, purpose = null;
  for (const raw of (markdown ?? "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if ((m = /^# (.+)$/.exec(line))) { out.title = m[1].trim(); continue; }
    if ((m = /^## (.+)$/.exec(line))) {
      const h = m[1].trim();
      purpose = /^purpose$/i.test(h) ? [] : null;
      section = /^(ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/i.exec(h)?.[1].toUpperCase() ?? (/^requirements$/i.test(h) ? "Requirements" : null);
      req = scen = null;
      continue;
    }
    if ((m = /^### Requirement: (.+)$/.exec(line))) { req = { name: m[1].trim(), section, text: [], scenarios: [] }; out.requirements.push(req); scen = null; continue; }
    if ((m = /^#### Scenario: (.+)$/.exec(line))) { if (req) { scen = { name: m[1].trim(), lines: [] }; req.scenarios.push(scen); } continue; }
    if (purpose) { purpose.push(line); out.purpose = purpose.join("\n").trim() || null; continue; }
    if (scen) { if ((m = /^- \*\*(GIVEN|WHEN|THEN|AND)\*\*\s*(.*)$/.exec(line))) scen.lines.push({ kw: m[1], text: m[2].trim() }); continue; }
    if (req) req.text.push(line);
  }
  for (const r of out.requirements) r.text = r.text.join("\n").trim();
  return out;
}

const renderRequirement = (r) => [`### Requirement: ${r.name}`, "", r.text, "", ...r.scenarios.flatMap((s) => [`#### Scenario: ${s.name}`, ...s.lines.map((l) => `- **${l.kw}** ${l.text}`), ""])].join("\n").replace(/\n+$/, "\n");

// A capability's spec, as openspec/specs/<capability>/spec.md.
export function renderSpec(name, cap) {
  return [`# ${name} Specification`, "", "## Purpose", "", cap.purpose ?? "TBD", "", "## Requirements", "", ...cap.requirements.map(renderRequirement)].join("\n").replace(/\n+$/, "\n");
}

// A change's delta for one capability, as openspec/changes/<change>/specs/<capability>/spec.md.
// `removed` ([{ name, reason, migration }]) and `renamed` ([{ from, to }]) are a person's decisions,
// written down in the stories (`parameters.spec.retires`): the sync never makes them up.
export function renderDelta(name, { purpose, added, modified, removed = [], renamed = [] }) {
  const parts = [`# ${name} Spec Delta`, ""];
  if (purpose) parts.push("## Purpose", "", purpose, "");
  if (added.length) parts.push("## ADDED Requirements", "", ...added.map(renderRequirement));
  if (modified.length) parts.push("## MODIFIED Requirements", "", ...modified.map(renderRequirement));
  if (removed.length) parts.push("## REMOVED Requirements", "", ...removed.map((r) => [`### Requirement: ${r.name}`, "", `**Reason**: ${r.reason}`, "", `**Migration**: ${r.migration}`, ""].join("\n")));
  if (renamed.length) parts.push("## RENAMED Requirements", "", ...renamed.map((r) => [`- FROM: \`### Requirement: ${r.from}\``, `- TO: \`### Requirement: ${r.to}\``, ""].join("\n")));
  return parts.join("\n").replace(/\n+$/, "\n");
}

// The retirements declared for one capability, checked: each names a requirement, and says why it
// goes (and where its readers go next) or what it is renamed to. Returns the sound ones and the
// problems with the rest.
export function retirements(declared, capability) {
  const out = [], problems = [];
  for (const d of declared.filter((x) => x.capability === capability)) {
    const where = `${d.file}: retires "${d.requirement ?? "?"}"`;
    if (!d.requirement) problems.push(`${d.file}: a retires entry names no requirement`);
    else if (d.renamedTo && (d.reason || d.migration)) problems.push(`${where}: a rename takes no reason or migration (its text is the renamed requirement's)`);
    else if (!d.renamedTo && !d.reason) problems.push(`${where}: say why it goes ("reason"), or what it is renamed to ("renamedTo")`);
    else if (!d.renamedTo && !d.migration) problems.push(`${where}: say where its readers go next ("migration")`);
    else if (out.some((x) => x.requirement === d.requirement)) problems.push(`${where}: retired twice`);
    else out.push(d);
  }
  return { retires: out, problems };
}

const same = (a, b) => JSON.stringify({ t: a.text.trim(), s: a.scenarios.map((s) => [s.name, s.lines]) }) === JSON.stringify({ t: b.text.trim(), s: b.scenarios.map((s) => [s.name, s.lines]) });

// What the stories say against what the spec says: requirements to add, to replace in full
// (OpenSpec's MODIFIED carries the whole requirement), unchanged ones, and those the spec has
// that no story covers. An uncovered requirement is only reported (`missing`) unless a person
// retired it in the stories (`retires`, from `retirements`): then it is `removed`, with their reason
// and migration, or `renamed`, when the stories cover it under its new name (and `modified` under
// that name if its text or scenarios changed too). A retirement the spec no longer has is spent and
// says nothing; one for a requirement the stories still cover is a problem.
export function diff(main, cap, retires = []) {
  const current = main?.requirements.filter((r) => r.section === "Requirements") ?? [];
  const added = [], modified = [], unchanged = [], removed = [], renamed = [], problems = [];
  const covered = (name) => cap.requirements.some((x) => x.name === name);
  const renames = new Map();
  for (const d of retires) {
    const was = current.find((x) => x.name === d.requirement);
    if (covered(d.requirement)) { problems.push(`retires "${d.requirement}", which the stories still cover`); continue; }
    if (!was) continue;
    if (!d.renamedTo) { removed.push({ name: d.requirement, reason: d.reason, migration: d.migration }); continue; }
    if (!covered(d.renamedTo)) { problems.push(`renames "${d.requirement}" to "${d.renamedTo}", which no story covers`); continue; }
    if (current.some((x) => x.name === d.renamedTo)) { problems.push(`renames "${d.requirement}" to "${d.renamedTo}", which the spec already has`); continue; }
    renames.set(d.renamedTo, was);
    renamed.push({ from: d.requirement, to: d.renamedTo });
  }
  for (const r of cap.requirements) {
    const was = renames.get(r.name) ?? current.find((x) => x.name === r.name);
    if (!was) added.push(r); else if (same(was, r)) unchanged.push(r); else modified.push(r);
  }
  const settled = new Set([...removed.map((r) => r.name), ...renamed.map((r) => r.from)]);
  const missing = current.filter((r) => !covered(r.name) && !settled.has(r.name));
  return { added, modified, unchanged, missing, removed, renamed, problems };
}
