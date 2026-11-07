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
