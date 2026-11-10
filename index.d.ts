/** What a play step gets: Storybook's play context (canvasElement, args, step, and on 8.3+ canvas and userEvent). */
import type { WalkthroughDeclaration } from './walkthrough/index.js';
export interface PlayContext {
  canvasElement: HTMLElement;
  args: any;
  /** Storybook's step: it may return a promise or nothing, so a step is always awaited. */
  step: (label: string, play: (context: PlayContext) => Promise<void> | void) => Promise<void> | void;
  canvas: any;
  userEvent: any;
  [key: string]: any;
}

export interface ScenarioSpec {
  /** Opt this scenario into a screenshot-led manual. */
  walkthrough?: WalkthroughDeclaration;
  /** The scenario's name in the spec; the export's name, spaced out, when absent. */
  name?: string;
  /** The state the scenario starts from, beyond what the story's args already say. */
  given?: string;
  /** What happens: the When step runs `act`. */
  when: string;
  /** What must hold afterwards: the Then step runs `check`. */
  then: string;
  /** Further Then lines, also verified by `check`. */
  and?: string[];
  /** The requirement this scenario belongs to, when not the file's (`parameters.spec.requirement` on the meta). */
  requirement?: string;
  /** That requirement's SHALL statement, when the file's meta doesn't carry it. */
  shall?: string;
  act?: (context: PlayContext) => Promise<unknown> | void;
  check?: (context: PlayContext) => Promise<void> | void;
}

export interface ScenarioStory {
  tags: string[];
  parameters: Record<string, any> & { scenario: Omit<ScenarioSpec, "act" | "check"> };
  play: (context: PlayContext) => Promise<void>;
}

/** A story with a scenario: `base` (a story object, as the project's factories make it) with the
 *  scenario's words in its parameters and a play of Given (the base's play), When (`act`) and
 *  Then (`check`) steps. */
export function scenario<S extends object = {}>(spec: ScenarioSpec, base?: S): S & ScenarioStory;

/** Capture an explicitly declared checkpoint, or do nothing when no runner is attached. */
export function captureCheckpoint(context: PlayContext, id: string): Promise<void>;
