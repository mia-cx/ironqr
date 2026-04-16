import type { GridResolution } from './geometry.js';

/**
 * Samples the QR module grid from a binarized image using the resolved geometry.
 *
 * Each module cell is sampled at 5 sub-pixel positions — the center plus four
 * cardinal offsets in the cell's local grid basis — and assigned by weighted
 * vote. Corner sampling was too hostile to rounded and dotted module styles:
 * the cell center is often correct while the corners stay light. A centered
 * cross keeps the vote inside the module's likely ink footprint while still
 * catching hollow/ring modules whose center alone can be light.
 *
 * @param width - Image width in pixels (used for bounds clamping).
 * @param height - Image height in pixels (used for bounds clamping).
 * @param resolution - Grid geometry resolved from finder patterns.
 * @param binary - Binarized pixel array (0 = dark, 255 = light).
 * @returns A 2D boolean grid where `true` = dark module.
 */
export const sampleGrid = (
  width: number,
  height: number,
  resolution: GridResolution,
  binary: Uint8Array,
): boolean[][] => {
  const { size, samplePoint } = resolution;

  const isDarkAt = (x: number, y: number): boolean => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    return (binary[py * width + px] ?? 255) === 0;
  };

  const localBasis = (row: number, col: number) => {
    const center = samplePoint(row, col);
    const left = samplePoint(row, Math.max(0, col - 1));
    const right = samplePoint(row, Math.min(size - 1, col + 1));
    const up = samplePoint(Math.max(0, row - 1), col);
    const down = samplePoint(Math.min(size - 1, row + 1), col);

    const scale = 0.2;
    const xStep =
      col === 0
        ? { x: (right.x - center.x) * scale, y: (right.y - center.y) * scale }
        : col === size - 1
          ? { x: (center.x - left.x) * scale, y: (center.y - left.y) * scale }
          : { x: (right.x - left.x) * 0.5 * scale, y: (right.y - left.y) * 0.5 * scale };
    const yStep =
      row === 0
        ? { x: (down.x - center.x) * scale, y: (down.y - center.y) * scale }
        : row === size - 1
          ? { x: (center.x - up.x) * scale, y: (center.y - up.y) * scale }
          : { x: (down.x - up.x) * 0.5 * scale, y: (down.y - up.y) * 0.5 * scale };

    return { center, xStep, yStep };
  };

  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const { center, xStep, yStep } = localBasis(row, col);
      let darkVotes = 0;
      // Center carries the strongest weight; rounded/dotted modules often do
      // not reach the cell corners, but they do occupy the centre. The four
      // axial probes catch hollow/ring modules whose center alone can be light.
      if (isDarkAt(center.x, center.y)) darkVotes += 3;
      if (isDarkAt(center.x - xStep.x, center.y - xStep.y)) darkVotes += 1;
      if (isDarkAt(center.x + xStep.x, center.y + xStep.y)) darkVotes += 1;
      if (isDarkAt(center.x - yStep.x, center.y - yStep.y)) darkVotes += 1;
      if (isDarkAt(center.x + yStep.x, center.y + yStep.y)) darkVotes += 1;
      // Total possible votes = 7; require 4+ so center-plus-one, or a hollow
      // ring's four axial hits, both classify as dark.
      return darkVotes >= 4;
    }),
  );
};
