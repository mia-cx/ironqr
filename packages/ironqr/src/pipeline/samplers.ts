import type { GridResolution } from './geometry.js';

/**
 * Supported logical-grid samplers.
 */
export type DecodeSampler = 'cross-vote' | 'dense-vote' | 'nearest';

/**
 * Samples a logical QR grid using the requested sampler.
 *
 * @param width - Binary image width.
 * @param height - Binary image height.
 * @param geometry - Resolved QR geometry.
 * @param binary - Thresholded binary pixels.
 * @param sampler - Sampler strategy.
 * @returns A square boolean grid where `true` means a dark module.
 */
export const sampleGrid = (
  width: number,
  height: number,
  geometry: GridResolution,
  binary: Uint8Array,
  sampler: DecodeSampler = 'cross-vote',
): boolean[][] => {
  if (sampler === 'nearest') return sampleNearest(width, height, geometry, binary);
  if (sampler === 'dense-vote') return sampleDenseVote(width, height, geometry, binary);
  return sampleCrossVote(width, height, geometry, binary);
};

/**
 * Center-weighted cross sampler.
 *
 * This is the default sampler because it keeps most probes inside the likely
 * ink footprint for rounded, dotted, and slightly misregistered modules.
 *
 * @param width - Binary image width.
 * @param height - Binary image height.
 * @param geometry - Resolved QR geometry.
 * @param binary - Thresholded binary pixels.
 * @returns A sampled logical grid.
 */
export const sampleCrossVote = (
  width: number,
  height: number,
  geometry: GridResolution,
  binary: Uint8Array,
): boolean[][] => {
  const { size } = geometry;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const center = geometry.samplePoint(row, col);
      const left = geometry.samplePoint(row, Math.max(0, col - 1));
      const right = geometry.samplePoint(row, Math.min(size - 1, col + 1));
      const up = geometry.samplePoint(Math.max(0, row - 1), col);
      const down = geometry.samplePoint(Math.min(size - 1, row + 1), col);
      const stepX = { x: (right.x - left.x) * 0.12, y: (right.y - left.y) * 0.12 };
      const stepY = { x: (down.x - up.x) * 0.12, y: (down.y - up.y) * 0.12 };

      let darkVotes = 0;
      if (isDark(binary, width, height, center.x, center.y)) darkVotes += 3;
      if (isDark(binary, width, height, center.x - stepX.x, center.y - stepX.y)) darkVotes += 1;
      if (isDark(binary, width, height, center.x + stepX.x, center.y + stepX.y)) darkVotes += 1;
      if (isDark(binary, width, height, center.x - stepY.x, center.y - stepY.y)) darkVotes += 1;
      if (isDark(binary, width, height, center.x + stepY.x, center.y + stepY.y)) darkVotes += 1;
      return darkVotes >= 4;
    }),
  );
};

/**
 * Single-sample nearest-neighbor sampler.
 *
 * This is useful as a rescue path when the cross sampler over-smooths tiny or
 * sharply thresholded modules.
 *
 * @param width - Binary image width.
 * @param height - Binary image height.
 * @param geometry - Resolved QR geometry.
 * @param binary - Thresholded binary pixels.
 * @returns A sampled logical grid.
 */
export const sampleDenseVote = (
  width: number,
  height: number,
  geometry: GridResolution,
  binary: Uint8Array,
): boolean[][] => {
  const { size } = geometry;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const center = geometry.samplePoint(row, col);
      const left = geometry.samplePoint(row, Math.max(0, col - 1));
      const right = geometry.samplePoint(row, Math.min(size - 1, col + 1));
      const up = geometry.samplePoint(Math.max(0, row - 1), col);
      const down = geometry.samplePoint(Math.min(size - 1, row + 1), col);
      const stepX = { x: (right.x - left.x) * 0.16, y: (right.y - left.y) * 0.16 };
      const stepY = { x: (down.x - up.x) * 0.16, y: (down.y - up.y) * 0.16 };
      let dark = 0;
      let total = 0;
      for (const xMul of [-1, 0, 1] as const) {
        for (const yMul of [-1, 0, 1] as const) {
          if (
            isDark(
              binary,
              width,
              height,
              center.x + stepX.x * xMul + stepY.x * yMul,
              center.y + stepX.y * xMul + stepY.y * yMul,
            )
          ) {
            dark += 1;
          }
          total += 1;
        }
      }
      return dark >= Math.ceil(total / 2);
    }),
  );
};

export const sampleNearest = (
  width: number,
  height: number,
  geometry: GridResolution,
  binary: Uint8Array,
): boolean[][] => {
  const { size } = geometry;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const point = geometry.samplePoint(row, col);
      return isDark(binary, width, height, point.x, point.y);
    }),
  );
};

const isDark = (
  binary: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean => {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  return (binary[py * width + px] ?? 255) === 0;
};
