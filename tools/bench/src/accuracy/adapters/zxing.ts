import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import { buildLuminanceBuffer, invertLuminanceBuffer } from '../../shared/image.js';
import type { AccuracyEngine, AccuracyScanResult } from '../types.js';
import {
  createAvailableAvailability,
  createCachePolicy,
  createCapabilities,
  failureResult,
  successResult,
} from './shared.js';

const decodeCandidate = (
  luminance: Uint8ClampedArray,
  width: number,
  height: number,
): string | null => {
  const bitmap = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(luminance, width, height)),
  );
  const reader = new QRCodeReader();
  return reader.decode(bitmap).getText();
};

const scanWithZxing = async (
  asset: Parameters<AccuracyEngine['scan']>[0],
): Promise<AccuracyScanResult> => {
  try {
    const image = await asset.loadImage();
    const luminance = buildLuminanceBuffer(image);
    for (const candidate of [luminance, invertLuminanceBuffer(luminance)]) {
      try {
        const text = decodeCandidate(candidate, image.width, image.height);
        if (text) return successResult([{ text }]);
      } catch {
        // try next polarity candidate
      }
    }
    return successResult([], 'no_decode');
  } catch (error) {
    return failureResult(error);
  }
};

export const zxingAccuracyEngine: AccuracyEngine = {
  id: 'zxing',
  kind: 'third-party',
  capabilities: createCapabilities({
    multiCode: false,
    inversion: 'caller',
    rotation: 'native',
    runtime: 'js',
  }),
  cache: createCachePolicy({ enabled: true, version: 'adapter-v1' }),
  availability: createAvailableAvailability,
  scan: scanWithZxing,
};
