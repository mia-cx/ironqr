/**
 * A detected finder pattern candidate with estimated center and module sizes.
 *
 * `hModuleSize` and `vModuleSize` are tracked separately so downstream geometry
 * can recover the per-finder pixel extents in each direction — the affine /
 * homography fit needs that to model perspective distortion.
 */
import type { Point } from '../contracts/geometry.js';

export interface FinderCandidate {
  readonly cx: number;
  readonly cy: number;
  /** Average of horizontal and vertical module sizes (kept for backwards compatibility). */
  readonly moduleSize: number;
  readonly hModuleSize: number;
  readonly vModuleSize: number;
  /** Optional local module-axis estimates from transform-aware matcher paths. */
  readonly axisU?: Point;
  readonly axisV?: Point;
  readonly score?: number;
  readonly source?: 'row-scan' | 'flood' | 'matcher';
}

export type FinderTriple = readonly [FinderCandidate, FinderCandidate, FinderCandidate];

const FINDER_SQUARENESS_TOLERANCE = 1.2;
const FINDER_POOL_SIZE = 12;
const FINDER_POOL_OVERLAP_MODULES = 7;

/**
 * Scans a binarized image for QR finder pattern candidates.
 *
 * Walks each row looking for 1:1:3:1:1 dark/light run ratios, then cross-checks
 * each candidate vertically. Returns up to 3 best non-overlapping candidates.
 *
 * @param binary - Binarized pixel array (0 = dark, 255 = light).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns Up to 3 finder pattern candidates: the best L-shape triple if one
 * exists, otherwise the deduped/filtered candidate pool (which may be 0–2).
 */
export const detectFinderPatterns = (
  binary: Uint8Array,
  width: number,
  height: number,
): FinderCandidate[] => {
  return pickThreeOrPool(detectFinderCandidatePool(binary, width, height));
};

/**
 * Returns the deduped, squareness-filtered candidate pool from raw scan hits.
 * Exported for scan pipelines that want to enumerate alternative finder triples
 * (e.g. to fall back through several triples when the best one doesn't decode).
 */
export const detectFinderCandidatePool = (
  binary: Uint8Array,
  width: number,
  height: number,
): readonly FinderCandidate[] => {
  return reduceCandidatePool(collectRawCandidates(binary, width, height));
};

/**
 * Walks the binary image row by row collecting every 1:1:3:1:1 run that
 * survives a vertical cross-check. The result is unsorted and unfiltered
 * apart from per-row dedup against already-collected candidates.
 */
const collectRawCandidates = (
  binary: Uint8Array,
  width: number,
  height: number,
): FinderCandidate[] => {
  const candidates: FinderCandidate[] = [];

  for (let row = 0; row < height; row += 1) {
    const runs: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let runPhase = 0; // 0..4
    let currentColor = 255; // start assuming light
    let col = 0;

    // Skip leading light pixels
    while (col < width && (binary[row * width + col] ?? 255) === 255) {
      col += 1;
    }

    if (col >= width) continue;
    currentColor = 0; // now on dark
    let runStart = col;

    for (; col <= width; col += 1) {
      const pixel = col < width ? (binary[row * width + col] ?? 255) : 255 ^ currentColor;
      if (pixel === currentColor) continue;

      runs[runPhase] = col - runStart;

      if (runPhase === 4) {
        if (isFinderRatio(runs)) {
          const moduleSize = (runs[0] + runs[1] + runs[2] + runs[3] + runs[4]) / 7;
          const cx = col - runs[4] - runs[3] - runs[2] / 2 - 0.5;
          const vCheck = crossCheckVertical(binary, width, height, cx, row, moduleSize);

          if (vCheck !== null) {
            const finalModuleSize = (moduleSize + vCheck.moduleSize) / 2;
            const refinedCy = vCheck.cy;

            // Deduplicate: skip if too close to an existing candidate
            const duplicate = candidates.some(
              (c) =>
                Math.abs(c.cx - cx) < finalModuleSize * 5 &&
                Math.abs(c.cy - refinedCy) < finalModuleSize * 5,
            );

            if (!duplicate) {
              candidates.push({
                cx,
                cy: refinedCy,
                moduleSize: finalModuleSize,
                hModuleSize: moduleSize,
                vModuleSize: vCheck.moduleSize,
              });
            }
          }
        }

        // Slide window: drop first run, shift remaining
        runs[0] = runs[2];
        runs[1] = runs[3];
        runs[2] = runs[4];
        runs[3] = 0;
        runs[4] = 0;
        runPhase = 3;
      } else {
        runPhase += 1;
      }

      currentColor = pixel;
      runStart = col;
    }
  }

  return candidates;
};

/**
 * Squareness pre-filter + dedupe + module-size sort + size cap. Shared by the
 * default 3-finder API and the candidate-pool API.
 */
const reduceCandidatePool = (candidates: readonly FinderCandidate[]): FinderCandidate[] => {
  // Real finders are square: their horizontal and vertical module sizes match
  // closely. False positives in stylized data regions can have wildly different
  // h/v sizes and yet outscore real finders by averaged moduleSize. Drop those
  // before the top-3 sort.
  const squareCandidates = candidates.filter((c) => {
    const hv = Math.max(c.hModuleSize, c.vModuleSize) / Math.min(c.hModuleSize, c.vModuleSize);
    return hv <= FINDER_SQUARENESS_TOLERANCE;
  });

  // Sort largest-first so the most prominent candidates win when the pool
  // overflows. Pool size dominates triple-scoring cost (C(n,3) is 220 at n=12).
  squareCandidates.sort((a, b) => b.moduleSize - a.moduleSize);
  const pool: FinderCandidate[] = [];
  for (const candidate of squareCandidates) {
    const overlaps = pool.some(
      (existing) =>
        Math.abs(existing.cx - candidate.cx) < candidate.moduleSize * FINDER_POOL_OVERLAP_MODULES &&
        Math.abs(existing.cy - candidate.cy) < candidate.moduleSize * FINDER_POOL_OVERLAP_MODULES,
    );
    if (!overlaps) pool.push(candidate);
    if (pool.length === FINDER_POOL_SIZE) break;
  }

  return pool;
};

/**
 * Default 3-finder API: returns the single best triple as the first 3 entries
 * of the result, or the pool itself if too few candidates exist to triple-pick.
 */
const pickThreeOrPool = (pool: readonly FinderCandidate[]): FinderCandidate[] => {
  if (pool.length < 3) return [...pool];
  const best = pickBestTriple(pool);
  return best ? [...best] : pool.slice(0, 3);
};

/**
 * Returns the top-K geometrically-plausible triples from `pool`, sorted
 * best-first. Used by the scan pipeline to fall back through alternative
 * triples when the best-scoring one doesn't decode — a noisy scene can
 * produce several QR-shaped Ls and only the decoder knows which is real.
 *
 * Returns the empty array when no triple is plausible.
 */
export const findBestFinderTriples = (
  finders: readonly FinderCandidate[],
  k: number,
): readonly FinderTriple[] => {
  if (finders.length < 3) return [];
  const limit = Number.isFinite(k) ? Math.max(0, Math.trunc(k)) : 0;
  if (limit === 0) return [];

  return scoreFinderTriples(finders)
    .slice(0, limit)
    .map((entry) => entry.triple);
};

/**
 * Scores every 3-combination of `pool` by QR L-shape consistency and returns
 * the best triple, or null if no triple is plausible.
 *
 * A real QR finder triple has:
 *   - three finders with matching module sizes (tight ratio)
 *   - one finder is the right-angle vertex (top-left); the other two sit at
 *     the ends of two perpendicular arms of equal length
 *
 * Score = module-size variance + length asymmetry + angle penalty. Lower wins.
 */
const pickBestTriple = (pool: readonly FinderCandidate[]): FinderTriple | null => {
  return findBestFinderTriples(pool, 1)[0] ?? null;
};

/** Returns an L-shape consistency score for the triple, or null when implausible. */
const scoreTriple = (
  fa: FinderCandidate,
  fb: FinderCandidate,
  fc: FinderCandidate,
): number | null => {
  // Reject triples whose module sizes disagree too much; they are usually
  // drawn from different QR symbols or include a false positive. Keep this
  // loose enough for perspective compression at the far finder: the nearest
  // and farthest finder in a photographed QR can differ by well over 30%.
  const sizes = [fa.moduleSize, fb.moduleSize, fc.moduleSize];
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const sizeRatio = maxSize / minSize;
  if (sizeRatio > 1.45) return null;

  // The vertex finder is the one opposite the longest side (the hypotenuse).
  const dAB = pointDist(fa.cx, fa.cy, fb.cx, fb.cy);
  const dAC = pointDist(fa.cx, fa.cy, fc.cx, fc.cy);
  const dBC = pointDist(fb.cx, fb.cy, fc.cx, fc.cy);

  let vertex: FinderCandidate;
  let armA: FinderCandidate;
  let armB: FinderCandidate;
  let hypotenuse: number;
  let leg1: number;
  let leg2: number;
  if (dAB >= dAC && dAB >= dBC) {
    vertex = fc;
    armA = fa;
    armB = fb;
    hypotenuse = dAB;
    leg1 = dAC;
    leg2 = dBC;
  } else if (dAC >= dAB && dAC >= dBC) {
    vertex = fb;
    armA = fa;
    armB = fc;
    hypotenuse = dAC;
    leg1 = dAB;
    leg2 = dBC;
  } else {
    vertex = fa;
    armA = fb;
    armB = fc;
    hypotenuse = dBC;
    leg1 = dAB;
    leg2 = dAC;
  }

  const avgLeg = (leg1 + leg2) / 2;
  const avgModuleSize = (fa.moduleSize + fb.moduleSize + fc.moduleSize) / 3;

  // Legs must be at least 7 modules long (the finder span itself) for the
  // triple to plausibly span a QR symbol.
  if (avgLeg < avgModuleSize * 7) return null;

  // Equal-leg score: how asymmetric the two short sides are.
  const legAsymmetry = Math.abs(leg1 - leg2) / avgLeg;

  // Pythagorean score: hypotenuse should be √2 × leg.
  const expectedHypotenuse = avgLeg * Math.SQRT2;
  const hypotenuseError = Math.abs(hypotenuse - expectedHypotenuse) / expectedHypotenuse;

  // Module-size consistency.
  const sizeError = sizeRatio - 1;

  // Per-leg version plausibility: leg length / module size = (size - 7) where
  // size = version*4 + 17, so leg/module = version*4 + 10. Must round close
  // to a valid version 1-40, and the rounding error itself must be small —
  // a triple drawn from random foliage will land at any leg length and
  // would otherwise score 0 on this term after rounding.
  const modulesAcross = avgLeg / avgModuleSize;
  const rawVersion = (modulesAcross - 10) / 4;
  if (rawVersion < 0.7 || rawVersion > 40.3) return null;
  const nearestVersion = Math.max(1, Math.min(40, Math.round(rawVersion)));
  const expectedModulesAcross = nearestVersion * 4 + 10;
  // Reject if the leg length is more than ~half a module off from the
  // nearest legal version's expected leg length — the triple is plausibly
  // an L-shape but not a QR-shaped L.
  if (Math.abs(modulesAcross - expectedModulesAcross) > 1.0) return null;
  const versionError = Math.abs(modulesAcross - expectedModulesAcross) / expectedModulesAcross;

  // Avoid unused-var lint on `vertex` / `armA` / `armB` — they exist for
  // future per-triple logic; mark them used.
  void vertex;
  void armA;
  void armB;

  return legAsymmetry * 2 + hypotenuseError * 2 + sizeError + versionError * 4;
};

const scoreFinderTriples = (
  pool: readonly FinderCandidate[],
): readonly { readonly triple: FinderTriple; readonly score: number }[] => {
  const scored: Array<{ readonly triple: FinderTriple; readonly score: number }> = [];
  for (let i = 0; i < pool.length - 2; i += 1) {
    for (let j = i + 1; j < pool.length - 1; j += 1) {
      for (let k = j + 1; k < pool.length; k += 1) {
        const fa = pool[i];
        const fb = pool[j];
        const fc = pool[k];
        if (!fa || !fb || !fc) continue;
        const score = scoreTriple(fa, fb, fc);
        if (score === null) continue;
        scored.push({ triple: [fa, fb, fc], score });
      }
    }
  }
  scored.sort((left, right) => left.score - right.score);
  return scored;
};

const pointDist = (ax: number, ay: number, bx: number, by: number): number => {
  return Math.hypot(bx - ax, by - ay);
};

/**
 * Checks whether five run lengths satisfy the QR finder 1:1:3:1:1 ratio.
 *
 * @param runs - Five consecutive run lengths.
 * @returns True when the runs match the expected ratio within 50% tolerance.
 */
const isFinderRatio = (runs: readonly [number, number, number, number, number]): boolean => {
  const total = runs[0] + runs[1] + runs[2] + runs[3] + runs[4];
  if (total < 7) return false;

  const module = total / 7;
  const maxVariance = module * 0.5;

  return (
    Math.abs(runs[0] - module) < maxVariance &&
    Math.abs(runs[1] - module) < maxVariance &&
    Math.abs(runs[2] - 3 * module) < 3 * maxVariance &&
    Math.abs(runs[3] - module) < maxVariance &&
    Math.abs(runs[4] - module) < maxVariance
  );
};

/**
 * Result of a successful vertical cross-check of a finder candidate.
 */
interface VerticalCheckResult {
  readonly moduleSize: number;
  /** Refined y-center of the pattern. */
  readonly cy: number;
}

/**
 * Verifies a horizontal finder candidate by cross-checking vertically.
 *
 * Scans upward and downward from the given pixel to confirm the 1:1:3:1:1
 * pattern also holds in the column direction. Also computes the true vertical
 * center of the finder pattern from the run extents.
 *
 * @param binary - Binarized pixel array.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param cx - Candidate center x coordinate.
 * @param cy - Candidate center y coordinate (scan row).
 * @param hModuleSize - Horizontal module size estimate.
 * @returns Refined center and module size, or null if not a finder.
 */
const crossCheckVertical = (
  binary: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  hModuleSize: number,
): VerticalCheckResult | null => {
  const col = Math.round(cx);
  const row = Math.round(cy);

  // Scan up from center — center pixel must be dark; bail if rounding landed on light.
  let count0 = 0;
  let r = row;
  const centerColor = binary[r * width + col] ?? 255;
  if (centerColor !== 0) return null;
  while (r >= 0 && (binary[r * width + col] ?? 255) === centerColor) {
    count0 += 1;
    r -= 1;
  }
  if (r < 0) return null;

  let count1 = 0;
  while (r >= 0 && (binary[r * width + col] ?? 255) !== centerColor) {
    count1 += 1;
    r -= 1;
  }
  if (r < 0) return null;

  let count2 = 0;
  while (r >= 0 && (binary[r * width + col] ?? 255) === centerColor) {
    count2 += 1;
    r -= 1;
  }

  // Scan down from center
  let count3 = 0;
  r = row + 1;
  while (r < height && (binary[r * width + col] ?? 255) === centerColor) {
    count3 += 1;
    r += 1;
  }
  if (r >= height) return null;

  let count4 = 0;
  while (r < height && (binary[r * width + col] ?? 255) !== centerColor) {
    count4 += 1;
    r += 1;
  }
  if (r >= height) return null;

  const runs: [number, number, number, number, number] = [
    count2,
    count1,
    count0 + count3,
    count4,
    0,
  ];

  // Scan past the outer dark band to get the last run
  let count5 = 0;
  while (r < height && (binary[r * width + col] ?? 255) === centerColor) {
    count5 += 1;
    r += 1;
  }
  runs[4] = count5;

  if (!isFinderRatio(runs)) return null;

  const vModuleSize = (runs[0] + runs[1] + runs[2] + runs[3] + runs[4]) / 7;
  if (Math.abs(vModuleSize - hModuleSize) > hModuleSize) return null;

  // Compute the true vertical center from the extent of the full 7-module span.
  // The dark center (3 modules) runs from (row - count0 + 1) to (row + count3).
  // The outer span top = top of run2, bottom = bottom of run4.
  const topOfSpan = row - count0 + 1 - count1 - count2;
  const bottomOfSpan = row + count3 + count4 + count5;
  const refinedCy = (topOfSpan + bottomOfSpan) / 2;

  return { moduleSize: vModuleSize, cy: refinedCy };
};
