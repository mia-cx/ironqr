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
  collectComponentStats,
  computeContainingComponents,
  labelConnectedComponents,
  type ComponentStats,
} from './components.js';
import type { FinderCandidate } from './detect.js';

/**
 * Detects finder pattern candidates by labelling connected components.
 *
 * Returns a list of candidates whose `moduleSize`, `hModuleSize`, and
 * `vModuleSize` are estimated from the ring's bounding-box extents (it spans
 * 7 modules per side). The list is unsorted and unfiltered — callers should
 * dedupe and pick triples themselves.
 */
export const detectFinderCandidatesFlood = (
  binary: Uint8Array,
  width: number,
  height: number,
): FinderCandidate[] => {
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

  const minPixels = 12;
  const maxPixels = (width * height) >> 2;

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
        // Validate the area ratio. Dark stone : dark ring = 9 : 24 = 0.375.
        // Allow ±50% slack because pixel rounding distorts small finders heavily.
        const ratio = stone.pixelCount / ring.pixelCount;
        if (ratio < 0.15 || ratio > 0.7) continue;

        // Reject highly elongated rings: a real finder's bounding-box
        // aspect ratio is at most ~2 even under heavy perspective.
        const ringW = ring.maxX - ring.minX + 1;
        const ringH = ring.maxY - ring.minY + 1;
        const aspect = Math.max(ringW, ringH) / Math.min(ringW, ringH);
        if (aspect > 2.5) continue;

        // Module size from area is rotation-invariant: the ring (dark border
        // of a 7×7 finder, hollow inside the inner 5×5) covers 24 modules,
        // so moduleSize = sqrt(ringPixelCount / 24). The bounding-box-based
        // h/v sizes are reported equal to keep downstream code (which assumes
        // axis-aligned row-scan finders) from rejecting tilted finders.
        const moduleSize = Math.sqrt(ring.pixelCount / 24);

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

