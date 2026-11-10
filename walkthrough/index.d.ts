export interface SourceIdentity {
  repository: string;
  revision: string;
  digest: string;
  dirty: boolean;
  url: string;
}
export interface CapturePoint {
  id: string;
  caption: string;
  alt: string;
  callouts?: { number: number; rect: [number, number, number, number]; text: string }[];
}
export interface WalkthroughDeclaration {
  id: string;
  title: string;
  chapter: string;
  order: number;
  checkpoints: CapturePoint[];
}
export interface Walkthrough {
  version: 1;
  task: { id: string; scenario: string; title: string; chapter: string; order: number };
  sources: Record<string, SourceIdentity>;
  run: {
    status: 'completed';
    adapter: 'web' | 'native';
    renderer: string;
    theme: string;
    viewport: { width: number; height: number };
    scale: number;
    required: string[];
  };
  steps: (CapturePoint & { image: string; digest: string; width: number; height: number })[];
}
export const walkthroughVersion: 1;
export function validateWalkthrough(bundle: unknown, expectedSources?: Record<string, SourceIdentity>): Walkthrough;
export function validateWalkthroughs(bundles: Walkthrough[]): Walkthrough[];
