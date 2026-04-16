export interface ComponentStats {
  readonly id: number;
  readonly color: number;
  pixelCount: number;
  sumX: number;
  sumY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centroidX: number;
  centroidY: number;
}

/** Labels 4-connected same-colour components in a binary image. */
export const labelConnectedComponents = (
  binary: Uint8Array,
  width: number,
  height: number,
): Uint32Array => {
  const labels = new Uint32Array(width * height);
  const parent: number[] = [0];

  const findRoot = (x: number): number => {
    let cur = x;
    while ((parent[cur] ?? 0) !== cur) {
      const p = parent[cur] ?? 0;
      parent[cur] = parent[p] ?? 0;
      cur = parent[cur] ?? 0;
    }
    return cur;
  };

  const union = (a: number, b: number): number => {
    const ra = findRoot(a);
    const rb = findRoot(b);
    if (ra === rb) return ra;
    if (ra < rb) {
      parent[rb] = ra;
      return ra;
    }
    parent[ra] = rb;
    return rb;
  };

  let nextId = 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const colour = binary[i] ?? 255;
      const leftLabel = x > 0 && (binary[i - 1] ?? 255) === colour ? labels[i - 1] : 0;
      const upLabel = y > 0 && (binary[i - width] ?? 255) === colour ? labels[i - width] : 0;

      if (leftLabel && upLabel) {
        labels[i] = union(leftLabel, upLabel);
      } else if (leftLabel) {
        labels[i] = leftLabel;
      } else if (upLabel) {
        labels[i] = upLabel;
      } else {
        labels[i] = nextId;
        parent[nextId] = nextId;
        nextId += 1;
      }
    }
  }

  for (let i = 0; i < labels.length; i += 1) {
    labels[i] = findRoot(labels[i] ?? 0);
  }

  return labels;
};

/** Computes centroid and bounds for each connected component id. */
export const collectComponentStats = (
  labels: Uint32Array,
  binary: Uint8Array,
  width: number,
  height: number,
): ComponentStats[] => {
  const byId = new Map<number, ComponentStats>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const id = labels[i] ?? 0;
      if (id === 0) continue;
      let stats = byId.get(id);
      if (!stats) {
        stats = {
          id,
          color: binary[i] ?? 255,
          pixelCount: 0,
          sumX: 0,
          sumY: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          centroidX: 0,
          centroidY: 0,
        };
        byId.set(id, stats);
      }
      stats.pixelCount += 1;
      stats.sumX += x;
      stats.sumY += y;
      if (x < stats.minX) stats.minX = x;
      if (x > stats.maxX) stats.maxX = x;
      if (y < stats.minY) stats.minY = y;
      if (y > stats.maxY) stats.maxY = y;
    }
  }

  for (const stats of byId.values()) {
    stats.centroidX = stats.sumX / stats.pixelCount;
    stats.centroidY = stats.sumY / stats.pixelCount;
  }

  return Array.from(byId.values());
};

/**
 * Returns each component id mapped to the id of the component that immediately
 * contains it, or 0 for top-level components.
 */
export const computeContainingComponents = (
  labels: Uint32Array,
  components: readonly ComponentStats[],
  width: number,
  height: number,
): Record<number, number> => {
  const parents: Record<number, number> = { 0: 0 };
  for (const component of components) {
    if (component.minY === 0) {
      parents[component.id] = 0;
      continue;
    }
    const probeX = Math.round((component.minX + component.maxX) / 2);
    const probeY = component.minY - 1;
    if (probeX < 0 || probeX >= width || probeY < 0 || probeY >= height) {
      parents[component.id] = 0;
      continue;
    }
    const parentId = labels[probeY * width + probeX] ?? 0;
    parents[component.id] = parentId === component.id ? 0 : parentId;
  }
  return parents;
};
