import jsQRModule from 'jsqr';
import type { AccuracyEngine, AccuracyScanResult } from '../types.js';
import {
  createAvailableAvailability,
  createCachePolicy,
  createCapabilities,
  failureResult,
  successResult,
} from './shared.js';

type JsqrDecode = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    readonly inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst';
  },
) => { readonly data: string } | null;

const jsQR = jsQRModule as unknown as JsqrDecode;

const scanWithJsqr = async (
  asset: Parameters<AccuracyEngine['scan']>[0],
): Promise<AccuracyScanResult> => {
  try {
    const image = await asset.loadImage();
    const decoded = jsQR(image.data, image.width, image.height, {
      inversionAttempts: 'attemptBoth',
    });
    return successResult(decoded ? [{ text: decoded.data }] : [], decoded ? null : 'no_decode');
  } catch (error) {
    return failureResult(error);
  }
};

export const jsqrAccuracyEngine: AccuracyEngine = {
  id: 'jsqr',
  kind: 'third-party',
  capabilities: createCapabilities({
    multiCode: false,
    inversion: 'native',
    rotation: 'native',
    runtime: 'js',
  }),
  cache: createCachePolicy({ enabled: true, version: 'adapter-v1' }),
  availability: createAvailableAvailability,
  scan: scanWithJsqr,
};
