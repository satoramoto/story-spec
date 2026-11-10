# story-spec

Storybook stories as OpenSpec scenarios. A story declares its Given / When / Then once, with
`scenario()`; its play runs them as named steps, autodocs prints them under the story, and
`story-spec sync` writes the OpenSpec spec (or a change's delta) from the stories without
running anything. The stories are the spec; the spec file is derived, and `--check` keeps it so.

```tsx
import { scenario } from 'story-spec';

const meta = {
  title: 'Music/Controls/SeekBar', component: SeekBar,
  parameters: { spec: { capability: 'music-seek-bar', requirement: 'Seeking', shall: 'The seek bar SHALL …', purpose: '…' } },
};

export const PressSeeks: Story = scenario({
  when: 'the pointer presses the slider at its middle',
  then: 'onSeek is called with 60 and the slider reads 60',
  act: async ({ canvasElement }) => { … },
  check: async ({ canvasElement, args }) => { … },
}, story({ args: {} }));
```

`scenario(spec, base?)`: `base` is the story as the project's own factories made it (args,
render, decorators, parameters: all kept); the result adds `parameters.scenario`, the docs
description, the `scenario` tag, and a play of Given (the base's play, if any), When (`act`) and
Then (`check`). `given`, `and: [...]`, `name`, and a per-scenario `requirement` and `shall` (for
a file that covers more than one requirement) are optional.

The file's meta carries `parameters.spec`: `capability` (the folder under `openspec/specs/`),
`requirement`, its `shall` statement (OpenSpec needs SHALL or MUST), and `purpose` for a new
capability.

```sh
story-spec list                      # what the stories declare
story-spec sync --change seek-bar    # openspec/changes/seek-bar/specs/<capability>/spec.md, ADDED and MODIFIED vs openspec/specs
story-spec sync --specs              # openspec/specs/<capability>/spec.md directly
story-spec sync --change seek-bar --check   # exit 1 when a file would change
```

Where `openspec/` is comes from OpenSpec itself: `sync` runs `openspec context --json` in the
project and writes under the root it reports. A project whose `openspec/config.yaml` says
`store: <id>` therefore writes into that store; a repo-local project writes beside its code.

Requirements in the spec that no story covers are reported and never removed. The project
supplies Storybook (8.3 or later): the stories are read with its `csf-tools`, and `step`,
`canvas` and `userEvent` come from its play context.

## Visual walkthroughs

Opt a scenario into a manual, then capture inside its existing play:

```js
import { scenario, captureCheckpoint } from 'story-spec';

export const Search = scenario({
  when: 'a reader searches for a topic',
  then: 'the matching page is offered',
  walkthrough: {
    id: 'find-documentation', title: 'Find documentation', chapter: 'Getting started', order: 1,
    checkpoints: [{ id: 'result', caption: 'Choose the matching page.', alt: 'Search results with a matching page link.' }],
  },
  act: async context => { /* use the real search control */ },
  check: async context => {
    /* assert the matching page is present */
    await captureCheckpoint(context, 'result');
  },
});
```

Checkpoints are awaited by a capture runner and are no-ops in ordinary Storybook.
They do not add When/Then clauses or change generated specs. Captions and alt text
belong to the scenario; no second tutorial script is needed.

### Portable evidence

`story-spec/walkthrough` exports the browser-safe `validateWalkthrough` and
`validateWalkthroughs`, plus TypeScript types. `story-spec/walkthrough/schema.json`
describes bundle v1. `story-spec/walkthrough/node` separately exports
`readWalkthrough(directory, expectedSources)` and `sourceIdentity(root, inputs, settings)`.
These entries import neither React nor Storybook. Native producers emit the same JSON.

A bundle is `manifest.json` plus relative PNG files. It contains a task, source
identities, a completed run and ordered screenshot steps. Each image has dimensions,
a SHA-256 digest, caption and alt text. Optional callouts use a positive integer,
normalized `[x, y, width, height]` rectangle and text. Source identities contain
repository URL, full revision, source-input digest, dirty flag and source URL.

Supply expected sources independently of the manifest. Hash explicit input trees,
lockfiles and capture settings, excluding generated folders. The filesystem reader
checks real paths, dimensions and image hashes; publication must not accept partial
runs or fall back to previous captures. Source identity is reproducibility metadata,
not an attestation of an untrusted producer.

`story-spec/walkthrough/capture` exports `walkthroughStories(index, projectRoot)`
and `captureStory({ browser, url, storyId, sources, output, ...settings })`.
The caller supplies a Playwright browser and served Storybook; the adapter owns
and closes its context. `output` must be a new directory. The server must expose
`manual-build.json`, containing source identities recorded at successful build
time. Capture rejects a fingerprint mismatch before playing the story. Zen's
`scripts/build-storybook.mjs` and `scripts/capture-manual.mjs` are the reference
bounded build/capture pipeline. No Playwright dependency is loaded by the contract.
