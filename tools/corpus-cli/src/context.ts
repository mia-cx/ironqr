import type { CliUi } from './ui.js';

/** Runtime dependencies injected into every CLI command handler. */
export interface AppContext {
  readonly repoRoot: string;
  readonly ui: CliUi;
  readonly ensureImageViewer: () => Promise<void>;
  readonly openImage: (filePath: string) => Promise<void>;
  readonly openExternal: (target: string) => Promise<void>;
  readonly detectGithubLogin: () => string | undefined;
}
