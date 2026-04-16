/** Thrown when the user cancels an interactive prompt (e.g. Ctrl+C). */
export class CliCancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CliCancelledError';
  }
}

/** Options for a single-line or multiline text input prompt. */
export interface TextPromptOptions {
  readonly message: string;
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly multiline?: boolean;
  readonly validate?: (value: string) => string | undefined;
}

/** Options for a yes/no confirmation prompt. */
export interface ConfirmPromptOptions {
  readonly message: string;
  readonly initialValue?: boolean;
}

/** Allowed value types for a select prompt option. */
export type SelectValue = string | number | boolean;

/** A single item in a select prompt list. */
export interface SelectOption<T extends SelectValue> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

/** Options for a select (single-choice) prompt. */
export interface SelectPromptOptions<T extends SelectValue> {
  readonly message: string;
  readonly initialValue?: T;
  readonly options: readonly SelectOption<T>[];
}

/** Abstraction over interactive terminal UI — prompts, spinners, and log output. */
export interface CliUi {
  readonly verbose: boolean;
  intro(message: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
  text(options: TextPromptOptions): Promise<string>;
  confirm(options: ConfirmPromptOptions): Promise<boolean>;
  select<T extends SelectValue>(options: SelectPromptOptions<T>): Promise<T>;
  spin<T>(message: string, task: () => Promise<T>): Promise<T>;
}
