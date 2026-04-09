import type {
  DecodeGridInput,
  DecodeGridResult,
  ScanFrameInput,
  ScanImageInput,
  ScanOptions,
  ScanResult,
  ScanStreamInput,
  ScanStreamOptions,
} from './contracts/index.js';
import { decodeGridLogical } from './internal/decode-grid.js';
import { notImplemented } from './internal/not-implemented.js';

export * from './contracts/index.js';
export { ScannerError } from './internal/errors.js';
export { ScannerNotImplementedError } from './internal/not-implemented.js';

export async function decodeGrid(input: DecodeGridInput): Promise<DecodeGridResult> {
  return decodeGridLogical({ grid: input.grid });
}

export async function scanFrame(
  _input: ScanFrameInput,
  _options?: ScanOptions,
): Promise<readonly ScanResult[]> {
  return notImplemented('scanFrame');
}

export async function scanImage(
  input: ScanImageInput,
  options?: ScanOptions,
): Promise<readonly ScanResult[]> {
  return scanFrame(input, options);
}

export async function scanStream(
  _input: ScanStreamInput,
  _options?: ScanStreamOptions,
): Promise<readonly ScanResult[]> {
  return notImplemented('scanStream');
}
