import { ALIGNMENT_PATTERN_CENTERS } from '../qr/qr-tables.js';
import type { ExtraCorrespondence, GridResolution } from './geometry.js';
import { assertImagePlaneLength } from './validation.js';

interface Basis {
  readonly center: { x: number; y: number };
  readonly u: { x: number; y: number };
  readonly v: { x: number; y: number };
  readonly moduleSize: number;
}

interface ScoredPoint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

interface AlignmentCell {
  readonly moduleRow: number;
  readonly moduleCol: number;
  readonly expectDark: boolean;
  readonly weight: number;
}

const MIN_ALIGNMENT_SEARCH_RADIUS = 3;
const MAX_ALIGNMENT_SEARCH_RADIUS = 24;
const ALIGNMENT_SEARCH_RADIUS_MODULES = 2.5;
const MIN_ALIGNMENT_SCORE_RATIO = 0.35;
const ALIGNMENT_CENTER_WEIGHT = 4;
const ALIGNMENT_OUTER_CORNER_WEIGHT = 2.5;
const ALIGNMENT_OUTER_EDGE_WEIGHT = 2;
const ALIGNMENT_INNER_WEIGHT = 1.5;

const ALIGNMENT_CELL_WEIGHTS = buildAlignmentCellWeights();
const MAX_ALIGNMENT_SCORE = ALIGNMENT_CELL_WEIGHTS.reduce((sum, cell) => sum + cell.weight, 0);

/**
 * Locates alignment-pattern centers near the current homography prediction.
 *
 * Uses the resolved grid to predict each alignment center and local module
 * basis, then searches a small pixel window for the best 5×5 alignment-pattern
 * signature. Returned correspondences can be fed into
 * `resolveGridFromCorrespondences()` to refit the homography with extra anchors.
 */
export const locateAlignmentPatternCorrespondences = (
  resolution: GridResolution,
  binary: Uint8Array,
  width: number,
  height: number,
): readonly ExtraCorrespondence[] => {
  if (resolution.version < 2) return [];
  assertImagePlaneLength(binary.length, width, height, 'locateAlignmentPatternCorrespondences');

  const centers = ALIGNMENT_PATTERN_CENTERS[resolution.version - 1];
  if (!centers || centers.length === 0) return [];

  const readDark = (x: number, y: number): boolean | null => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || px >= width || py < 0 || py >= height) return null;
    return binary[py * width + px] === 0;
  };

  const correspondences: ExtraCorrespondence[] = [];
  const size = resolution.size;

  for (const moduleRow of centers) {
    for (const moduleCol of centers) {
      if (
        (moduleRow === 6 && moduleCol === 6) ||
        (moduleRow === 6 && moduleCol === size - 7) ||
        (moduleRow === size - 7 && moduleCol === 6)
      ) {
        continue;
      }

      const basis = localBasis(resolution, moduleRow, moduleCol);
      const best = searchAlignmentCenter(basis, readDark);
      if (best === null) continue;

      correspondences.push({
        moduleRow,
        moduleCol,
        pixelX: best.x,
        pixelY: best.y,
      });
    }
  }

  return correspondences;
};

const searchAlignmentCenter = (
  basis: Basis,
  readDark: (x: number, y: number) => boolean | null,
): ScoredPoint | null => {
  const radius = Math.max(
    MIN_ALIGNMENT_SEARCH_RADIUS,
    Math.min(
      MAX_ALIGNMENT_SEARCH_RADIUS,
      Math.round(basis.moduleSize * ALIGNMENT_SEARCH_RADIUS_MODULES),
    ),
  );

  let best: ScoredPoint | null = null;
  for (let deltaY = -radius; deltaY <= radius; deltaY += 1) {
    for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
      const x = basis.center.x + deltaX;
      const y = basis.center.y + deltaY;
      const score = scoreAlignmentAt(x, y, basis, readDark);
      if (score === null) continue;
      if (best === null || score > best.score) {
        best = { x, y, score };
      }
    }
  }

  if (best === null) return null;
  if (best.score < MAX_ALIGNMENT_SCORE * MIN_ALIGNMENT_SCORE_RATIO) return null;

  return refineAlignmentCenter(best, basis, readDark);
};

const refineAlignmentCenter = (
  coarse: ScoredPoint,
  basis: Basis,
  readDark: (x: number, y: number) => boolean | null,
): ScoredPoint => {
  let current = coarse;
  for (const step of [0.5, 0.25] as const) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [deltaX, deltaY] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
        [step, step],
        [step, -step],
        [-step, step],
        [-step, -step],
      ] as const) {
        const nextX = current.x + deltaX;
        const nextY = current.y + deltaY;
        const nextScore = scoreAlignmentAt(nextX, nextY, basis, readDark);
        if (nextScore === null || nextScore <= current.score) continue;
        current = { x: nextX, y: nextY, score: nextScore };
        improved = true;
      }
    }
  }
  return current;
};

const scoreAlignmentAt = (
  centerX: number,
  centerY: number,
  basis: Basis,
  readDark: (x: number, y: number) => boolean | null,
): number | null => {
  let score = 0;
  for (const cell of ALIGNMENT_CELL_WEIGHTS) {
    const x = centerX + cell.moduleCol * basis.u.x + cell.moduleRow * basis.v.x;
    const y = centerY + cell.moduleCol * basis.u.y + cell.moduleRow * basis.v.y;
    const observed = readDark(x, y);
    if (observed === null) return null;
    score += observed === cell.expectDark ? cell.weight : -cell.weight;
  }
  return score;
};

const localBasis = (resolution: GridResolution, moduleRow: number, moduleCol: number): Basis => {
  const center = resolution.samplePoint(moduleRow, moduleCol);
  const left = resolution.samplePoint(moduleRow, Math.max(0, moduleCol - 1));
  const right = resolution.samplePoint(moduleRow, Math.min(resolution.size - 1, moduleCol + 1));
  const up = resolution.samplePoint(Math.max(0, moduleRow - 1), moduleCol);
  const down = resolution.samplePoint(Math.min(resolution.size - 1, moduleRow + 1), moduleCol);

  let u: { x: number; y: number };
  if (moduleCol === 0) {
    u = { x: right.x - center.x, y: right.y - center.y };
  } else if (moduleCol === resolution.size - 1) {
    u = { x: center.x - left.x, y: center.y - left.y };
  } else {
    u = { x: (right.x - left.x) / 2, y: (right.y - left.y) / 2 };
  }

  let v: { x: number; y: number };
  if (moduleRow === 0) {
    v = { x: down.x - center.x, y: down.y - center.y };
  } else if (moduleRow === resolution.size - 1) {
    v = { x: center.x - up.x, y: center.y - up.y };
  } else {
    v = { x: (down.x - up.x) / 2, y: (down.y - up.y) / 2 };
  }

  return {
    center,
    u,
    v,
    moduleSize: (Math.hypot(u.x, u.y) + Math.hypot(v.x, v.y)) / 2,
  };
};

function buildAlignmentCellWeights(): readonly AlignmentCell[] {
  const cells: AlignmentCell[] = [];

  for (let moduleRow = -2; moduleRow <= 2; moduleRow += 1) {
    for (let moduleCol = -2; moduleCol <= 2; moduleCol += 1) {
      const outerRing = Math.abs(moduleRow) === 2 || Math.abs(moduleCol) === 2;
      const center = moduleRow === 0 && moduleCol === 0;
      const expectDark = outerRing || center;
      const manhattan = Math.abs(moduleRow) + Math.abs(moduleCol);
      const weight = center
        ? ALIGNMENT_CENTER_WEIGHT
        : outerRing
          ? manhattan === 4
            ? ALIGNMENT_OUTER_CORNER_WEIGHT
            : ALIGNMENT_OUTER_EDGE_WEIGHT
          : ALIGNMENT_INNER_WEIGHT;
      cells.push({ moduleRow, moduleCol, expectDark, weight });
    }
  }

  return cells;
}
