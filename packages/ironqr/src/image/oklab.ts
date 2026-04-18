import type { ImageDataLike } from '../contracts/scan.js';
import { numberAt } from './array.js';
import {
  assertImageBufferLength,
  assertImagePlaneLength,
  normalizeWindowRadius,
} from './validation.js';

const RGBA_CHANNELS = 4;
const WHITE_PIXEL = 255;
const MIN_CONTRAST_RADIUS = 12;
const CONTRAST_RADIUS_SHIFT = 5;
const CONTRAST_BYTE_SCALE = 64;
const VARIANCE_EPSILON = 1e-6;

export interface OklabPlanes {
  readonly width: number;
  readonly height: number;
  readonly l: Float32Array;
  readonly a: Float32Array;
  readonly b: Float32Array;
}

export interface OklabVector {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

export interface OklabContrastField {
  readonly width: number;
  readonly height: number;
  readonly magnitude: Uint8Array;
  sample: (x: number, y: number) => OklabVector;
}

/** Converts pixel-backed image data into OKLab planes after alpha compositing onto white. */
export const toOklabPlanes = (data: ImageDataLike): OklabPlanes => {
  const { width, height, data: pixels } = data;
  assertImageBufferLength(pixels.length, width, height, RGBA_CHANNELS, 'toOklabPlanes');

  const l = new Float32Array(width * height);
  const a = new Float32Array(width * height);
  const b = new Float32Array(width * height);

  for (let i = 0; i < l.length; i += 1) {
    const base = i * RGBA_CHANNELS;
    const alpha = (pixels[base + 3] as number) / WHITE_PIXEL;
    const backgroundWeight = 1 - alpha;
    const sr = ((pixels[base] as number) / WHITE_PIXEL) * alpha + backgroundWeight;
    const sg = ((pixels[base + 1] as number) / WHITE_PIXEL) * alpha + backgroundWeight;
    const sb = ((pixels[base + 2] as number) / WHITE_PIXEL) * alpha + backgroundWeight;

    const r = srgbToLinear(sr);
    const g = srgbToLinear(sg);
    const blue = srgbToLinear(sb);

    const lCone = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * blue);
    const mCone = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * blue);
    const sCone = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * blue);

    l[i] = 0.2104542553 * lCone + 0.793617785 * mCone - 0.0040720468 * sCone;
    a[i] = 1.9779984951 * lCone - 2.428592205 * mCone + 0.4505937099 * sCone;
    b[i] = 0.0259040371 * lCone + 0.7827717662 * mCone - 0.808675766 * sCone;
  }

  return { width, height, l, a, b };
};

/**
 * Builds a locally normalised OKLab evidence field.
 *
 * Each sample is normalised by the local mean and per-channel standard
 * deviation. This is a diagonal whitening pass: cheaper than full covariance
 * whitening but still enough to surface colourful low-luma QR/module contrast
 * in a transform-aware matcher.
 */
export const createOklabContrastField = (
  planes: OklabPlanes,
  radius = Math.max(
    MIN_CONTRAST_RADIUS,
    Math.min(planes.width, planes.height) >> CONTRAST_RADIUS_SHIFT,
  ),
): OklabContrastField => {
  const { width, height, l, a, b } = planes;
  assertImagePlaneLength(l.length, width, height, 'createOklabContrastField(l)');
  assertImagePlaneLength(a.length, width, height, 'createOklabContrastField(a)');
  assertImagePlaneLength(b.length, width, height, 'createOklabContrastField(b)');

  const normalizedRadius = normalizeWindowRadius(
    radius,
    Math.max(width, height),
    'createOklabContrastField',
  );
  const lStats = buildIntegralStats(l, width, height);
  const aStats = buildIntegralStats(a, width, height);
  const bStats = buildIntegralStats(b, width, height);

  const sample = (x: number, y: number): OklabVector => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError(
        `createOklabContrastField.sample: coordinates must be finite, got (${x}, ${y}).`,
      );
    }

    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    return normalisePixel(px, py, width, height, normalizedRadius, planes, {
      l: lStats,
      a: aStats,
      b: bStats,
    });
  };

  const magnitude = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const normalized = normalisePixel(x, y, width, height, normalizedRadius, planes, {
        l: lStats,
        a: aStats,
        b: bStats,
      });
      const contrast = Math.sqrt(
        normalized.l * normalized.l + normalized.a * normalized.a + normalized.b * normalized.b,
      );
      magnitude[index] = Math.min(WHITE_PIXEL, Math.round(contrast * CONTRAST_BYTE_SCALE));
    }
  }

  return { width, height, magnitude, sample };
};

interface IntegralStats {
  readonly sum: Float64Array;
  readonly sumSq: Float64Array;
}

interface PlaneStats {
  readonly l: IntegralStats;
  readonly a: IntegralStats;
  readonly b: IntegralStats;
}

const buildIntegralStats = (plane: Float32Array, width: number, height: number): IntegralStats => {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const sumSq = new Float64Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < width; x += 1) {
      const value = plane[y * width + x] as number;
      rowSum += value;
      rowSumSq += value * value;
      const index = (y + 1) * stride + (x + 1);
      sum[index] = numberAt(sum, y * stride + (x + 1)) + rowSum;
      sumSq[index] = numberAt(sumSq, y * stride + (x + 1)) + rowSumSq;
    }
  }

  return { sum, sumSq };
};

const normalisePixel = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  planes: OklabPlanes,
  stats: PlaneStats,
): OklabVector => {
  const index = y * width + x;
  return {
    l: normaliseAt(index, x, y, width, height, radius, planes.l, stats.l),
    a: normaliseAt(index, x, y, width, height, radius, planes.a, stats.a),
    b: normaliseAt(index, x, y, width, height, radius, planes.b, stats.b),
  };
};

const normaliseAt = (
  index: number,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  plane: Float32Array,
  stats: IntegralStats,
): number => {
  const stride = width + 1;
  const x0 = Math.max(0, x - radius);
  const y0 = Math.max(0, y - radius);
  const x1 = Math.min(width, x + radius + 1);
  const y1 = Math.min(height, y + radius + 1);
  const area = (x1 - x0) * (y1 - y0);
  const mean =
    (numberAt(stats.sum, y1 * stride + x1) -
      numberAt(stats.sum, y0 * stride + x1) -
      numberAt(stats.sum, y1 * stride + x0) +
      numberAt(stats.sum, y0 * stride + x0)) /
    area;
  const meanSq =
    (numberAt(stats.sumSq, y1 * stride + x1) -
      numberAt(stats.sumSq, y0 * stride + x1) -
      numberAt(stats.sumSq, y1 * stride + x0) +
      numberAt(stats.sumSq, y0 * stride + x0)) /
    area;
  const variance = Math.max(0, meanSq - mean * mean);
  return ((plane[index] as number) - mean) / Math.sqrt(variance + VARIANCE_EPSILON);
};

const srgbToLinear = (value: number): number => {
  if (value <= 0.04045) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
};
