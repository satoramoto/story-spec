import type { SourceIdentity, Walkthrough } from './index.js';
export function sha256(value: string | Uint8Array): string;
export function pngDimensions(bytes: Buffer): { width: number; height: number };
export function readWalkthrough(directory: string, expectedSources: Record<string, SourceIdentity>): Promise<Walkthrough>;
export function sourceIdentity(root: string, inputs: string[], settings?: Record<string, unknown>): Promise<SourceIdentity>;
