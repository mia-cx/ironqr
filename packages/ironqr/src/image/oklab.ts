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

/** Converts browser ImageData into OKLab planes after alpha compositing onto white. */
export const toOklabPlanes = (data: ImageData): OklabPlanes => {
  const { width, height, data: pixels } = data;
  const l = new Float32Array(width * height);
  const a = new Float32Array(width * height);
  const b = new Float32Array(width * height);

  for (let i = 0; i < l.length; i += 1) {
    const base = i * 4;
    const alpha = (pixels[base + 3] ?? 255) / 255;
    const bg = 1 - alpha;
    const sr = ((pixels[base] ?? 0) / 255) * alpha + bg;
    const sg = ((pixels[base + 1] ?? 0) / 255) * alpha + bg;
    const sb = ((pixels[base + 2] ?? 0) / 255) * alpha + bg;

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
  radius = Math.max(12, Math.min(planes.width, planes.height) >> 5),
): OklabContrastField => {
  const { width, height, l, a, b } = planes;
  const lStats = buildIntegralStats(l, width, height);
  const aStats = buildIntegralStats(a, width, height);
  const bStats = buildIntegralStats(b, width, height);

  const sample = (x: number, y: number): OklabVector => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    const index = py * width + px;
    return {
      l: normaliseAt(index, px, py, width, height, radius, l, lStats),
      a: normaliseAt(index, px, py, width, height, radius, a, aStats),
      b: normaliseAt(index, px, py, width, height, radius, b, bStats),
    };
  };

  const magnitude = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const zl = normaliseAt(index, x, y, width, height, radius, l, lStats);
      const za = normaliseAt(index, x, y, width, height, radius, a, aStats);
      const zb = normaliseAt(index, x, y, width, height, radius, b, bStats);
      const contrast = Math.sqrt(zl * zl + za * za + zb * zb);
      magnitude[index] = Math.min(255, Math.round(contrast * 64));
    }
  }

  return { width, height, magnitude, sample };
};

interface IntegralStats {
  readonly sum: Float64Array;
  readonly sumSq: Float64Array;
}

const buildIntegralStats = (plane: Float32Array, width: number, height: number): IntegralStats => {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const sumSq = new Float64Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < width; x += 1) {
      const value = plane[y * width + x] ?? 0;
      rowSum += value;
      rowSumSq += value * value;
      const idx = (y + 1) * stride + (x + 1);
      sum[idx] = f64(sum, y * stride + (x + 1)) + rowSum;
      sumSq[idx] = f64(sumSq, y * stride + (x + 1)) + rowSumSq;
    }
  }

  return { sum, sumSq };
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
    (f64(stats.sum, y1 * stride + x1) -
      f64(stats.sum, y0 * stride + x1) -
      f64(stats.sum, y1 * stride + x0) +
      f64(stats.sum, y0 * stride + x0)) /
    area;
  const meanSq =
    (f64(stats.sumSq, y1 * stride + x1) -
      f64(stats.sumSq, y0 * stride + x1) -
      f64(stats.sumSq, y1 * stride + x0) +
      f64(stats.sumSq, y0 * stride + x0)) /
    area;
  const variance = Math.max(0, meanSq - mean * mean);
  return ((plane[index] ?? 0) - mean) / Math.sqrt(variance + 1e-6);
};

const f64 = (array: Float64Array, index: number): number => array[index] as number;

const srgbToLinear = (value: number): number => {
  if (value <= 0.04045) return value / 12.92;
  return ((value + 0.055) / 1.055) ** 2.4;
};
