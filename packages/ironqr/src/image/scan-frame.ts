import { Effect } from 'effect';
import type { BrowserImageSource, ScanResult } from '../contracts/scan.js';
import { decodeGridLogical } from '../qr/index.js';
import { otsuBinarize, sauvolaBinarize, toGrayscale } from './binarize.js';
import { detectFinderCandidatePool, findBestFinderTriples } from './detect.js';
import { candidateVersions, resolveGrid } from './geometry.js';
import { toImageData } from './image.js';
import { sampleGrid } from './sample.js';

/**
 * Builds the single-frame QR scanning pipeline as an Effect program.
 *
 * Pipeline: toImageData → toGrayscale → binarize → detectFinderPatterns
 *   → resolveGrid → sampleGrid → decodeGridLogical → ScanResult[].
 *
 * Tries multiple binarization strategies and both polarities. Otsu (global
 * threshold) is fast and works for clean inputs; Sauvola (adaptive local
 * threshold) handles non-uniform illumination, small QRs in textured
 * scenes, and high-key photos where the QR's local foreground/background
 * relationship differs from the global one. Both polarities cover
 * light-on-dark QR codes.
 *
 * Succeeds with an empty array when no QR symbol is detected or decoding
 * fails. Fails through the Effect error channel when `toImageData` throws.
 *
 * @param input - Any supported browser image source.
 * @returns An Effect yielding one `ScanResult` per decoded QR symbol found.
 */
export const scanFrame = (input: BrowserImageSource) => {
  return Effect.gen(function* () {
    const imageData = yield* Effect.tryPromise(() => toImageData(input));
    const { width, height } = imageData;

    const luma = toGrayscale(imageData);

    // Order matters: cheap and most-likely-to-succeed first. Otsu normal
    // catches clean printed QRs in one pass; Sauvola is the fallback for
    // photos with non-uniform lighting or busy backgrounds. Inverted
    // variants handle light-on-dark codes.
    const otsu = otsuBinarize(luma, width, height);
    const candidates: Uint8Array[] = [otsu, invertBinary(otsu)];

    // Two Sauvola windows: the default (~1/8 of the shorter side) catches
    // QRs that fill a meaningful fraction of the frame; the small one
    // (fixed 24px) catches small QRs in busy scenes (book pages, signs).
    let sauvolaLarge: Uint8Array | null = null;
    let sauvolaSmall: Uint8Array | null = null;
    const lazySauvolaLarge = (): Uint8Array => {
      if (sauvolaLarge === null) sauvolaLarge = sauvolaBinarize(luma, width, height);
      return sauvolaLarge;
    };
    const lazySauvolaSmall = (): Uint8Array => {
      if (sauvolaSmall === null) sauvolaSmall = sauvolaBinarize(luma, width, height, 24);
      return sauvolaSmall;
    };

    // For each binary candidate, fetch the full finder pool (not just one
    // triple) and try the top-K best-scoring triples. A noisy scene can
    // produce several QR-shaped Ls; only the decoder knows which is real.
    const TRIPLES_PER_BINARY = 5;

    for (let i = 0; i < 6; i += 1) {
      let candidate: Uint8Array;
      if (i === 0) candidate = candidates[0]!;
      else if (i === 1) candidate = candidates[1]!;
      else if (i === 2) candidate = lazySauvolaLarge();
      else if (i === 3) candidate = invertBinary(lazySauvolaLarge());
      else if (i === 4) candidate = lazySauvolaSmall();
      else candidate = invertBinary(lazySauvolaSmall());

      const pool = detectFinderCandidatePool(candidate, width, height);
      if (pool.length < 3) continue;

      const triples = findBestFinderTriples(pool, TRIPLES_PER_BINARY);
      if (triples.length === 0) continue;

      for (const triple of triples) {
        // Try the finder-distance version estimate first, then ±1/±2. The
        // estimate is only ~85% reliable for v≥7 where one module of
        // misjudgement gives the wrong grid size; the encoded version info
        // bits in the QR will then refuse to decode against the wrong size.
        for (const version of candidateVersions(triple, 2)) {
          const resolution = resolveGrid(triple, version);
          if (resolution === null) continue;

          const grid = sampleGrid(width, height, resolution, candidate);

          const decoded = yield* decodeGridLogical({ grid }).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );

          if (decoded === null) continue;

          const result: ScanResult = {
            payload: decoded.payload,
            // TODO: replace with a real confidence signal (e.g. 1 - bestFormatHammingDistance / 15).
            confidence: 0.9,
            version: decoded.version,
            errorCorrectionLevel: decoded.errorCorrectionLevel,
            bounds: resolution.bounds,
            corners: resolution.corners,
            headers: decoded.headers,
            segments: decoded.segments,
          };

          return [result];
        }
      }
    }

    return [] as ScanResult[];
  });
};

/** Returns a new binary array with 0↔255 swapped. */
const invertBinary = (binary: Uint8Array): Uint8Array => {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary[i] === 0 ? 255 : 0;
  }
  return out;
};
