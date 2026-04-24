import type {
  AccuracyEngineAvailability,
  AccuracyEngineCachePolicy,
  AccuracyEngineCapabilities,
  AccuracyScanCode,
  AccuracyScanDiagnostics,
  AccuracyScanResult,
  EngineFailureReason,
} from '../types.js';

const asMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const createCapabilities = (value: AccuracyEngineCapabilities): AccuracyEngineCapabilities =>
  value;

export const createCachePolicy = (value: AccuracyEngineCachePolicy): AccuracyEngineCachePolicy =>
  value;

export const createAvailableAvailability = (): AccuracyEngineAvailability => ({
  available: true,
  reason: null,
});

export const createUnavailableAvailability = (reason: string): AccuracyEngineAvailability => ({
  available: false,
  reason,
});

export const successResult = (
  results: readonly AccuracyScanCode[],
  failureReason: EngineFailureReason | null = null,
  diagnostics: AccuracyScanDiagnostics | null = null,
): AccuracyScanResult => ({
  attempted: true,
  succeeded: true,
  results,
  failureReason,
  error: null,
  diagnostics,
});

export const failureResult = (
  error: unknown,
  failureReason: EngineFailureReason = 'engine_error',
  diagnostics: AccuracyScanDiagnostics | null = null,
): AccuracyScanResult => ({
  attempted: true,
  succeeded: false,
  results: [],
  failureReason,
  error: asMessage(error),
  diagnostics,
});

export const uniqueTexts = (values: readonly string[]): readonly string[] => {
  return [...new Set(values.filter((value) => value.length > 0))];
};

export const normalizeDecodedText = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0) end -= 1;
  return value.slice(0, end).trim();
};

export const serializeAsync = <Args extends readonly unknown[], Result>(
  run: (...args: Args) => Promise<Result>,
): ((...args: Args) => Promise<Result>) => {
  let tail = Promise.resolve();
  return (...args: Args): Promise<Result> => {
    const next = tail.then(() => run(...args));
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
};
