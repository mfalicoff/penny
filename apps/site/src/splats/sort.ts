// Back-to-front ordering for alpha blending: a 16-bit counting sort on view depth.

const BUCKETS = 65536;

export class DepthSorter {
  readonly count: number;
  private readonly depths: Float32Array;
  private readonly keys: Uint16Array;
  private readonly counts = new Uint32Array(BUCKETS);

  constructor(count: number) {
    this.count = count;
    this.depths = new Float32Array(count);
    this.keys = new Uint16Array(count);
  }

  /**
   * Fills `order` with splat indices from farthest to nearest. `viewZ(i)` is the splat's
   * view-space z: the camera looks down −z, so the farthest splat has the smallest value.
   */
  sort(viewZ: (i: number) => number, order: Uint32Array): Uint32Array {
    const { count, depths, keys, counts } = this;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < count; i++) {
      const z = viewZ(i);
      depths[i] = z;
      if (z < min) min = z;
      if (z > max) max = z;
    }
    const scale = max > min ? (BUCKETS - 1) / (max - min) : 0;
    counts.fill(0);
    for (let i = 0; i < count; i++) {
      const key = Math.floor((depths[i]! - min) * scale);
      keys[i] = key;
      counts[key]! += 1;
    }
    for (let k = 1; k < BUCKETS; k++) counts[k]! += counts[k - 1]!;
    for (let i = count - 1; i >= 0; i--) {
      const key = keys[i]!;
      counts[key]! -= 1;
      order[counts[key]!] = i;
    }
    return order;
  }
}
