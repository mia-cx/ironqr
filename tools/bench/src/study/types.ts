import type { CorpusBenchAsset } from '../accuracy/types.js';

/** Stable identifier used in CLI args, report names, and cache keys. */
export type StudyPluginId = string;

export type StudyPluginFlagType = 'string' | 'number' | 'boolean';

export interface StudyPluginFlag {
  readonly name: string;
  readonly type: StudyPluginFlagType;
  readonly description: string;
  readonly default?: string | number | boolean;
}

export interface StudyPluginOutput {
  readonly reportFile: string;
  readonly cacheFile?: string;
}

export interface StudyPluginContext {
  readonly repoRoot: string;
  readonly assets: readonly CorpusBenchAsset[];
  readonly output: StudyPluginOutput;
  readonly flags: Readonly<Record<string, string | number | boolean>>;
  readonly signal?: AbortSignal;
  readonly log: (message: string) => void;
}

export interface StudyPluginResult<Summary extends object = Record<string, unknown>> {
  readonly pluginId: StudyPluginId;
  readonly assetCount: number;
  readonly summary: Summary;
  readonly report: unknown;
}

export interface StudyPlugin<Summary extends object = Record<string, unknown>> {
  readonly id: StudyPluginId;
  readonly title: string;
  readonly description: string;
  readonly version: string;
  readonly flags?: readonly StudyPluginFlag[];
  run: (context: StudyPluginContext) => Promise<StudyPluginResult<Summary>>;
}
