import { type GridResolution, localGridBasis } from './geometry.js';
import { assertImagePlaneLength } from './validation.js';

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
  assertImagePlaneLength(binary.length, width, height, 'sampleGrid');
  const { size } = resolution;

  const isDarkAt = (x: number, y: number): boolean => {
    const px = Math.max(0, Math.min(width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(height - 1, Math.round(y)));
    return binary[py * width + px] === 0;
  };

  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const basis = localGridBasis(resolution, row, col);
      const center = basis.center;
      const xStep = { x: basis.right.x * 0.2, y: basis.right.y * 0.2 };
      const yStep = { x: basis.down.x * 0.2, y: basis.down.y * 0.2 };
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
