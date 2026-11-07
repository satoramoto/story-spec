// A story that is a scenario. `scenario(spec, base)` gives a story (base: what the project's own
// factories made, or nothing) its Given / When / Then: the play runs `act` as the When step and
// `check` as the Then step, so the Interactions panel reads like the spec; the words go into
// `parameters.scenario`, where `story-spec sync` reads them from the file without running
// anything, and into the docs description, so autodocs prints them under the story.
export function scenario(spec, base = {}) {
  const { name, given, when, then, and = [], requirement, shall, act, check } = spec;
  if (!when || !then) throw new Error("scenario(): `when` and `then` are required");
  const words = { ...(name && { name }), ...(given && { given }), when, then, ...(and.length && { and }), ...(requirement && { requirement }), ...(shall && { shall }) };
  const lines = [given && `**Given** ${given}`, `**When** ${when}`, `**Then** ${then}`, ...and.map((a) => `**And** ${a}`)].filter(Boolean);
  const play = async (ctx) => {
    if (base.play) await ctx.step(`Given ${given ?? "the story as set up"}`, (c) => base.play(c));
    if (act) await ctx.step(`When ${when}`, (c) => act(c));
    if (check) await ctx.step(`Then ${then}${and.length ? `, and ${and.join(", and ")}` : ""}`, (c) => check(c));
  };
  const docs = base.parameters?.docs ?? {};
  return {
    ...base,
    tags: [...(base.tags ?? []), "scenario"],
    parameters: { ...base.parameters, scenario: words, docs: { ...docs, description: { ...docs.description, story: lines.join("\n\n") } } },
    play,
  };
}
