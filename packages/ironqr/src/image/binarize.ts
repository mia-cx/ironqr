/**
 * Converts an RGBA `ImageData` to an 8-bit grayscale array using luminance weighting.
 *
 * Luminance formula: 0.299R + 0.587G + 0.114B (BT.601). Pixels with alpha < 255
 * are composited onto a white background first — matching browser and image-viewer
 * behaviour for transparent PNGs (a fully transparent pixel reads as white, the
 * colour the user actually sees).
 *
 * @param data - Source `ImageData`.
 * @returns Grayscale luma values, one byte per pixel.
 */
export const toGrayscale = (data: ImageData): Uint8Array => {
  const { width, height, data: pixels } = data;
  const luma = new Uint8Array(width * height);

  for (let i = 0; i < luma.length; i += 1) {
    const base = i * 4;
    const r = pixels[base] ?? 0;
    const g = pixels[base + 1] ?? 0;
    const b = pixels[base + 2] ?? 0;
    const a = pixels[base + 3] ?? 255;
    // Source-over composite onto white (255). a/255 is the foreground weight.
    const fg = a / 255;
    const bg = 1 - fg;
    const cr = r * fg + 255 * bg;
    const cg = g * fg + 255 * bg;
    const cb = b * fg + 255 * bg;
    luma[i] = Math.round(0.299 * cr + 0.587 * cg + 0.114 * cb);
  }

  return luma;
};

/**
 * Extracts a single channel (r=0, g=1, b=2) of the image into a grayscale
 * buffer, alpha-composited onto white.
 *
 * Useful as a binarization fallback for color QRs: a blue-on-white code has
 * very high BT.601 luma (~232) because B is weighted at 11%, so Otsu can't
 * split it cleanly from white. The blue channel itself carries the full
 * dynamic range of the QR pattern and binarizes correctly. We try the
 * channel that's most underweighted in luma when standard binarization
 * doesn't yield a decode.
 */
export const toChannelGray = (data: ImageData, channel: 0 | 1 | 2): Uint8Array => {
  const { width, height, data: pixels } = data;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const base = i * 4;
    const c = pixels[base + channel] ?? 0;
    const a = pixels[base + 3] ?? 255;
    const fg = a / 255;
    out[i] = Math.round(c * fg + 255 * (1 - fg));
  }
  return out;
};

/**
 * Binarizes a grayscale image using Otsu's global thresholding method.
 *
 * @param luma - Grayscale pixel values (0-255).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Binary array: 0 = dark (QR module), 255 = light (background).
 */
export const otsuBinarize = (luma: Uint8Array, width: number, height: number): Uint8Array => {
  const total = width * height;
  const histogram: number[] = new Array<number>(256).fill(0);

  for (let i = 0; i < total; i += 1) {
    const bucket = luma[i] ?? 0;
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }

  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) {
    sumAll += t * (histogram[t] ?? 0);
  }

  let weightBackground = 0;
  let sumBackground = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t] ?? 0;
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * (histogram[t] ?? 0);

    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const diff = meanBackground - meanForeground;
    const variance = weightBackground * weightForeground * diff * diff;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  const binary = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    binary[i] = (luma[i] ?? 0) > threshold ? 255 : 0;
  }

  return binary;
};

/**
 * Binarizes a grayscale image with Sauvola's adaptive (local) threshold.
 *
 * For each pixel, computes a per-window threshold:
 *   T = mean * (1 + k * (stddev / R - 1))
 * where window size is sized to roughly the QR module scale, k = 0.34, and
 * R = 128 (the dynamic-range half-point). Mean and stddev are computed in
 * O(1) per pixel using summed-area (integral) tables.
 *
 * Compared to Otsu, this captures the QR's local foreground/background
 * relationship even when the wider image is dominated by other content
 * (e.g. small QR on a textured page, or a high-key photo with one dark
 * sticker). The trade-off is per-pixel cost — we still try Otsu first in
 * the scan pipeline because it's cheaper and works for clean inputs.
 *
 * `radius` defaults to ~1/8 of the smaller image dimension. Pass an explicit
 * smaller radius to detect smaller QR codes embedded in busy scenes; pass a
 * larger one to suppress more high-frequency noise.
 *
 * @param luma - Grayscale pixel values (0-255).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param radius - Half-width of the local window in pixels. Defaults to
 *   `max(16, min(width, height) / 8)`.
 * @returns Binary array: 0 = dark, 255 = light.
 */
export const sauvolaBinarize = (
  luma: Uint8Array,
  width: number,
  height: number,
  radius: number = Math.max(16, Math.min(width, height) >> 3),
): Uint8Array => {
  const k = 0.34;
  const R = 128;

  // Build integral images for sum and sum-of-squares.
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const sumSq = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < width; x += 1) {
      const v = luma[y * width + x] ?? 0;
      rowSum += v;
      rowSumSq += v * v;
      const idx = (y + 1) * stride + (x + 1);
      sum[idx] = (sum[y * stride + (x + 1)] ?? 0) + rowSum;
      sumSq[idx] = (sumSq[y * stride + (x + 1)] ?? 0) + rowSumSq;
    }
  }

  const binary = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const area = (x1 - x0) * (y1 - y0);
      const a = sum[y0 * stride + x0] ?? 0;
      const b = sum[y0 * stride + x1] ?? 0;
      const c = sum[y1 * stride + x0] ?? 0;
      const d = sum[y1 * stride + x1] ?? 0;
      const mean = (d - b - c + a) / area;
      const aSq = sumSq[y0 * stride + x0] ?? 0;
      const bSq = sumSq[y0 * stride + x1] ?? 0;
      const cSq = sumSq[y1 * stride + x0] ?? 0;
      const dSq = sumSq[y1 * stride + x1] ?? 0;
      const variance = (dSq - bSq - cSq + aSq) / area - mean * mean;
      const stddev = variance > 0 ? Math.sqrt(variance) : 0;
      const threshold = mean * (1 + k * (stddev / R - 1));
      binary[y * width + x] = (luma[y * width + x] ?? 0) > threshold ? 255 : 0;
    }
  }

  return binary;
};
