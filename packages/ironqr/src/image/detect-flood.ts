/**
 * Flood-fill (connected-component) finder pattern detection.
 *
 * The row-scan 1:1:3:1:1 detector in `detect.ts` requires finders to be roughly
 * axis-aligned: a 20° rotation produces runs that no longer fit the expected
 * ratio. Real-world QR images (photographed labels, signs at angles, stickers
 * on curved surfaces) violate that assumption constantly.
 *
 * The finder pattern itself is rotation-invariant: a dark 7×7 ring around a
 * 5×5 light gap around a 3×3 dark stone, regardless of orientation. We can
 * detect that structure by labelling connected components of dark and light
 * pixels, then looking for triples (dark_ring, light_gap, dark_stone) where:
 *   - light_gap is contained within dark_ring
 *   - dark_stone is contained within light_gap
 *   - the dark_stone:dark_ring area ratio is ~9:24 = 0.375 (the QR spec ratio)
 *
 * This is the approach used by quirc (ISC, Daniel Beer) and is what gives
 * modern phone scanners their robustness to rotation and stylized finders.
 *
 * Returns a `FinderCandidate[]` compatible with the row-scan API so it can be
 * merged with that pool in the scan pipeline.
 */
import {
  type ComponentStats,
  collectComponentStats,
  computeContainingComponents,
  labelConnectedComponents,
} from './components.js';
import type { FinderCandidate } from './detect.js';
import { assertImagePlaneLength } from './validation.js';

const MIN_RING_PIXELS = 12;
const MAX_RING_FRACTION = 0.25;
const MIN_RING_RATIO = 0.15;
const MAX_RING_RATIO = 0.7;
const MAX_RING_ASPECT = 2.5;
const RING_MODULE_AREA = 24;

/**
 * Detects finder pattern candidates by labelling connected components.
 *
 * Returns a list of candidates whose `moduleSize`, `hModuleSize`, and
 * `vModuleSize` are estimated from the ring area (24 dark modules in the
 * canonical finder ring). The list is unsorted and unfiltered — callers
 * should dedupe and pick triples themselves.
 */
export const detectFinderCandidatesFlood = (
  binary: Uint8Array,
  width: number,
  height: number,
): FinderCandidate[] => {
  assertImagePlaneLength(binary.length, width, height, 'detectFinderCandidatesFlood');

  const labels = labelConnectedComponents(binary, width, height);
  const components = collectComponentStats(labels, binary, width, height);
  const parents = computeContainingComponents(labels, components, width, height);

  // Index light components by parent for O(N) ring iteration. Same for stones.
  const lightByParent = new Map<number, ComponentStats[]>();
  const darkByParent = new Map<number, ComponentStats[]>();
  for (const c of components) {
    const map = c.color === 255 ? lightByParent : darkByParent;
    const parentId = parents[c.id] ?? 0;
    const arr = map.get(parentId);
    if (arr) arr.push(c);
    else map.set(parentId, [c]);
  }

  const minPixels = MIN_RING_PIXELS;
  const maxPixels = Math.floor(width * height * MAX_RING_FRACTION);

  const candidates: FinderCandidate[] = [];
  for (const ring of components) {
    if (ring.color !== 0) continue; // ring must be dark
    if (ring.pixelCount < minPixels || ring.pixelCount > maxPixels) continue;

    const lights = lightByParent.get(ring.id);
    if (!lights) continue;

    for (const light of lights) {
      const stones = darkByParent.get(light.id);
      if (!stones) continue;

      for (const stone of stones) {
        // Dark stone : dark ring = 9 : 24 = 0.375. The accepted range is
        // intentionally wider than ±50% to tolerate aggressive stylisation and
        // pixel rounding in tiny finders.
        const ratio = stone.pixelCount / ring.pixelCount;
        if (ratio < MIN_RING_RATIO || ratio > MAX_RING_RATIO) continue;

        // Reject highly elongated rings. The accepted aspect ratio is still
        // loose enough to tolerate perspective-compressed finders.
        const ringW = ring.maxX - ring.minX + 1;
        const ringH = ring.maxY - ring.minY + 1;
        const aspect = Math.max(ringW, ringH) / Math.min(ringW, ringH);
        if (aspect > MAX_RING_ASPECT) continue;

        // Module size from area is rotation-invariant: the ring (dark border
        // of a 7×7 finder, hollow inside the inner 5×5) covers 24 modules,
        // so moduleSize = sqrt(ringPixelCount / RING_MODULE_AREA). The
        // downstream h/v sizes stay equal because the flood path is orientation
        // agnostic rather than axis-aligned.
        const moduleSize = Math.sqrt(ring.pixelCount / RING_MODULE_AREA);

        candidates.push({
          cx: ring.centroidX,
          cy: ring.centroidY,
          moduleSize,
          hModuleSize: moduleSize,
          vModuleSize: moduleSize,
        });
      }
    }
  }

  return candidates;
};
