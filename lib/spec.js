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
export function renderDelta(name, { purpose, added, modified }) {
  const parts = [`# ${name} Spec Delta`, ""];
  if (purpose) parts.push("## Purpose", "", purpose, "");
  if (added.length) parts.push("## ADDED Requirements", "", ...added.map(renderRequirement));
  if (modified.length) parts.push("## MODIFIED Requirements", "", ...modified.map(renderRequirement));
  return parts.join("\n").replace(/\n+$/, "\n");
}

const same = (a, b) => JSON.stringify({ t: a.text.trim(), s: a.scenarios.map((s) => [s.name, s.lines]) }) === JSON.stringify({ t: b.text.trim(), s: b.scenarios.map((s) => [s.name, s.lines]) });

// What the stories say against what the spec says: requirements to add, to replace in full
// (OpenSpec's MODIFIED carries the whole requirement), unchanged ones, and those the spec has
// that no story covers (reported, never removed: a human decides that).
export function diff(main, cap) {
  const current = main?.requirements.filter((r) => r.section === "Requirements") ?? [];
  const added = [], modified = [], unchanged = [];
  for (const r of cap.requirements) {
    const was = current.find((x) => x.name === r.name);
    if (!was) added.push(r); else if (same(was, r)) unchanged.push(r); else modified.push(r);
  }
  const missing = current.filter((r) => !cap.requirements.some((x) => x.name === r.name));
  return { added, modified, unchanged, missing };
}
