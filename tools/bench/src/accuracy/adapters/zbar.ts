import { createRequire } from 'node:module';
import { scanRGBABuffer, setModuleArgs, ZBarSymbolType } from '@undecaf/zbar-wasm';
import { cloneRgbaBuffer } from '../../shared/image.js';
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

interface ZBarSymbol {
  readonly type: ZBarSymbolType;
  readonly typeName: string;
  decode: (encoding?: string) => string;
}

const require = createRequire(import.meta.url);

const resolveZbarWasm = (): string => require.resolve('@undecaf/zbar-wasm/dist/zbar.wasm');

let zbarConfigured = false;

const ensureZbarConfigured = (): void => {
  if (zbarConfigured) return;
  setModuleArgs({ locateFile: () => resolveZbarWasm() });
  zbarConfigured = true;
};

const scanWithZbar = serializeAsync(
  async (asset: Parameters<AccuracyEngine['scan']>[0]): Promise<AccuracyScanResult> => {
    try {
      ensureZbarConfigured();
      const image = await asset.loadImage();
      const symbols = (await scanRGBABuffer(
        cloneRgbaBuffer(image.data).buffer,
        image.width,
        image.height,
      )) as readonly ZBarSymbol[];

      const results = symbols
        .filter((symbol) => symbol.type === ZBarSymbolType.ZBAR_QRCODE)
        .map((symbol) => ({
          text: normalizeDecodedText(symbol.decode()),
          kind: symbol.typeName,
        }))
        .filter((result) => result.text.length > 0);

      return successResult(results, results.length === 0 ? 'no_decode' : null);
    } catch (error) {
      return failureResult(error);
    }
  },
);

const zbarAvailability = () => {
  try {
    resolveZbarWasm();
    return createAvailableAvailability();
  } catch (error) {
    return createUnavailableAvailability(error instanceof Error ? error.message : String(error));
  }
};

export const zbarAccuracyEngine: AccuracyEngine = {
  id: 'zbar',
  kind: 'third-party',
  capabilities: createCapabilities({
    multiCode: true,
    inversion: 'native',
    rotation: 'native',
    runtime: 'wasm',
  }),
  cache: createCachePolicy({ enabled: true, version: 'adapter-v1' }),
  availability: zbarAvailability,
  scan: scanWithZbar,
};
