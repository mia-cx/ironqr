import cvModule from '@techstark/opencv-js';
import { normalizeDecodedText } from '../../shared/text.js';
import type { AccuracyEngine, AccuracyScanResult } from '../types.js';
import { createAvailableAvailability, failureResult, successResult } from './shared.js';

type OpenCv = typeof cvModule & {
  readonly matFromImageData: (imageData: {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
  }) => { delete: () => void };
  readonly Mat: new () => { delete: () => void };
  readonly QRCodeDetector: new () => {
    detectAndDecode: (image: unknown, points?: unknown, straight?: unknown) => string;
    delete?: () => void;
  };
  readonly cvtColor: (src: unknown, dst: unknown, code: unknown) => void;
  readonly COLOR_RGBA2GRAY: unknown;
  onRuntimeInitialized?: () => void;
};

let cvPromise: Promise<OpenCv> | null = null;

const getOpenCv = async (): Promise<OpenCv> => {
  if (cvPromise) return cvPromise;
  cvPromise = (async () => {
    const maybePromise = cvModule as unknown;
    if (maybePromise && typeof (maybePromise as Promise<OpenCv>).then === 'function') {
      return (await maybePromise) as OpenCv;
    }
    const cv = cvModule as OpenCv;
    if (typeof cv.QRCodeDetector === 'function') return cv;
    await new Promise<void>((resolve) => {
      cv.onRuntimeInitialized = () => resolve();
    });
    return cv;
  })();
  return cvPromise;
};

const scanWithOpenCv = async (
  asset: Parameters<AccuracyEngine['scan']>[0],
): Promise<AccuracyScanResult> => {
  let rgba: { delete: () => void } | null = null;
  let gray: { delete: () => void } | null = null;
  let detector: { detectAndDecode: (image: unknown) => string; delete?: () => void } | null = null;
  try {
    const [cv, image] = await Promise.all([getOpenCv(), asset.loadImage()]);
    rgba = cv.matFromImageData({ width: image.width, height: image.height, data: image.data });
    gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    detector = new cv.QRCodeDetector() as unknown as {
      detectAndDecode: (image: unknown) => string;
      delete?: () => void;
    };
    const decoded = detector.detectAndDecode(gray);
    const text = normalizeDecodedText(String(decoded ?? ''));
    return successResult(text.length > 0 ? [{ text }] : [], text.length > 0 ? null : 'no_decode');
  } catch (error) {
    return failureResult(error);
  } finally {
    detector?.delete?.();
    gray?.delete();
    rgba?.delete();
  }
};

export const opencvAccuracyEngine: AccuracyEngine = {
  id: 'opencv',
  kind: 'third-party',
  capabilities: {
    multiCode: false,
    inversion: 'none',
    rotation: 'native',
    runtime: 'wasm',
  },
  cache: { enabled: true, version: 'adapter-v1' },
  availability: createAvailableAvailability,
  scan: scanWithOpenCv,
};
