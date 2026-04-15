import { Effect } from 'effect';
import { scanFrame } from 'ironqr';
import sharp from 'sharp';
import type { AutoScan } from './schema.js';

interface ScanFrameResult {
  readonly payload: { readonly text: string; readonly kind?: string };
}

type ScanOutcome =
  | { readonly ok: true; readonly results: readonly ScanFrameResult[] }
  | { readonly ok: false; readonly error: unknown };

/** Scan a local image file for QR codes and return a normalized `AutoScan` result. */
export const scanLocalImageFile = (imagePath: string): Promise<AutoScan> => {
  return Effect.runPromise(scanLocalImageFileEffect(imagePath));
};

const scanLocalImageFileEffect = (imagePath: string) => {
  return Effect.gen(function* () {
    const imageData = yield* readImageData(imagePath);
    const scanResult = (yield* Effect.tryPromise(() =>
      scanFrame(imageData).then(
        (results: readonly ScanFrameResult[]) => ({ ok: true as const, results }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    )) as ScanOutcome;

    if (!scanResult.ok) {
      const message =
        scanResult.error instanceof Error ? scanResult.error.message : String(scanResult.error);
      console.warn(`Scan failed for ${imagePath}: ${message}`);
      return { attempted: true, succeeded: false, results: [] } satisfies AutoScan;
    }

    if (scanResult.results.length === 0) {
      return { attempted: true, succeeded: true, results: [] } satisfies AutoScan;
    }

    return {
      attempted: true,
      succeeded: true,
      results: scanResult.results.map((result) => ({
        text: result.payload.text,
        kind: result.payload.kind,
      })),
    } satisfies AutoScan;
  });
};

const readImageData = (imagePath: string) => {
  return Effect.tryPromise(async () => {
    const { data, info } = await sharp(imagePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return makeImageData(info.width, info.height, new Uint8ClampedArray(data));
  });
};

const makeImageData = (width: number, height: number, pixels: Uint8ClampedArray): ImageData => {
  // ImageData is a browser API; we construct a compatible object for ironqr's scanFrame
  return { width, height, data: pixels, colorSpace: 'srgb' } as unknown as ImageData;
};
