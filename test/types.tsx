// A type fixture: it compiles only if scenario() results are Storybook stories without a cast.
// `npm test` runs `tsc --noEmit -p test` on it; nothing here is executed.
import type { Meta, StoryObj } from '@storybook/react';
import { scenario } from '../index.js';

function Lamp({ lit }: { lit: boolean }) {
  return <span aria-label={lit ? 'lit' : 'off'} />;
}

const meta = {
  title: 'Fixture/Lamp',
  component: Lamp,
  parameters: { spec: { capability: 'fixture-lamp', requirement: 'The lamp shows its state', shall: 'The lamp SHALL show whether it is lit.' } },
  args: { lit: false },
} satisfies Meta<typeof Lamp>;
export default meta;
type Story = StoryObj<typeof meta>;

// A scenario with every step, over an empty base.
export const LightsUp: Story = scenario(
  {
    when: 'the lamp is lit',
    then: 'it reads lit',
    act: async ({ canvasElement, step }) => {
      await step('look', () => {
        canvasElement.querySelector('span');
      });
    },
    check: async ({ canvasElement }) => {
      canvasElement.querySelector('[aria-label="lit"]');
    },
  },
  {},
);

// A scenario over a base with its own args, and only a check.
export const StaysOff: Story = scenario(
  { given: 'a lamp that was never lit', when: 'nothing happens', then: 'it reads off', check: () => {} },
  { args: { lit: false } },
);
