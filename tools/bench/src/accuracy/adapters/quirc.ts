import { createRequire } from 'node:module';
import path from 'node:path';
import { buildLuminanceBuffer } from '../../shared/image.js';
import type { AccuracyEngine, AccuracyScanResult } from '../types.js';
import {
  createAvailableAvailability,
  createCachePolicy,
  createCapabilities,
  createUnavailableAvailability,
  failureResult,
  normalizeDecodedText,
  serializeAsync,
  successResult,
} from './shared.js';

interface QuircResult {
  readonly data: {
    readonly text?: string;
  };
}

interface QuircDecoder {
  decode: (
    image: Uint8Array | Uint8ClampedArray | ArrayBuffer,
    width: number,
    height: number,
  ) => readonly QuircResult[];
}

interface QuircConstructor {
  new (instance: WebAssembly.Instance): QuircDecoder;
}

const require = createRequire(import.meta.url);

const resolveQuirc = (): { readonly Quirc: QuircConstructor; readonly wasmPath: string } => {
  const entryPath = require.resolve('quirc');
  const module = require(entryPath) as { Quirc: QuircConstructor };
  return {
    Quirc: module.Quirc,
    wasmPath: path.resolve(path.dirname(entryPath), '../libquirc.wasm'),
  };
};

let quircModule: Promise<WebAssembly.Module> | null = null;

const createQuircDecoder = async (): Promise<QuircDecoder> => {
  const { Quirc, wasmPath } = resolveQuirc();
  quircModule ??= Bun.file(wasmPath)
    .arrayBuffer()
    .then((binary) => WebAssembly.compile(binary));
  const instance = await WebAssembly.instantiate(await quircModule);
  return new Quirc(instance);
};

const scanWithQuirc = serializeAsync(
  async (asset: Parameters<AccuracyEngine['scan']>[0]): Promise<AccuracyScanResult> => {
    try {
      const decoder = await createQuircDecoder();
      const image = await asset.loadImage();
      const results = decoder.decode(buildLuminanceBuffer(image), image.width, image.height);
      return successResult(
        results.flatMap((result) => {
          const text = result.data.text ? normalizeDecodedText(result.data.text) : '';
          return text.length > 0 ? [{ text }] : [];
        }),
        results.length === 0 ? 'no_decode' : null,
      );
    } catch (error) {
      return failureResult(error);
    }
  },
);

const quircAvailability = () => {
  try {
    resolveQuirc();
    return createAvailableAvailability();
  } catch (error) {
    return createUnavailableAvailability(error instanceof Error ? error.message : String(error));
  }
};

export const quircAccuracyEngine: AccuracyEngine = {
  id: 'quirc',
  kind: 'third-party',
  capabilities: createCapabilities({
    multiCode: true,
    inversion: 'none',
    rotation: 'native',
    runtime: 'wasm',
  }),
  cache: createCachePolicy({ enabled: true, version: 'adapter-v1' }),
  availability: quircAvailability,
  scan: scanWithQuirc,
};
