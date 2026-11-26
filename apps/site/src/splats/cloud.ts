// A set of 3D Gaussian splats in the standard 3DGS parameterisation: centre, per-axis
// standard deviation (scale), rotation quaternion (w, x, y, z) and sRGB colour with opacity.
// Pure TypeScript with no DOM or Node APIs, so it runs in the page, the sort worker and Node.

export type Vec3 = readonly [number, number, number];

export interface SplatCloud {
  readonly count: number;
  /** x, y, z per splat. */
  readonly positions: Float32Array;
  /** Standard deviations along the splat's local x, y, z axes. */
  readonly scales: Float32Array;
  /** Unit quaternion w, x, y, z per splat. */
  readonly rotations: Float32Array;
  /** r, g, b, opacity per splat, 0–255. */
  readonly colors: Uint8Array;
  /**
   * Unit surface normal (x, y, z) and how much it is lit (0 = emissive glow, 1 = fully shaded
   * metal) per splat. Floats: quantized normals band a sharp highlight.
   */
  readonly normals: Float32Array;
  /** How far each splat drifts while the scene rests, in world units (0 for surfaces). */
  readonly drift: Float32Array;
}

export interface SplatInput {
  readonly position: Vec3;
  /** Standard deviations along tangent, bitangent and normal. */
  readonly scale: Vec3;
  /** Unit normal; the splat's local z axis. Defaults to +z. */
  readonly normal?: Vec3;
  /** Direction of the first scale axis; projected onto the plane of the normal. */
  readonly tangent?: Vec3;
  /** sRGB 0–1. */
  readonly color: Vec3;
  readonly opacity: number;
  /** 0 = unlit (glow, dust), 1 = lit like polished metal. Needs a meaningful normal. */
  readonly shading?: number;
  /** How far it drifts while the scene rests, in world units: dust only. Defaults to 0. */
  readonly drift?: number;
}

export class SplatBuilder {
  readonly capacity: number;
  private length = 0;
  private readonly cloud: SplatCloud;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cloud = {
      count: capacity,
      positions: new Float32Array(capacity * 3),
      scales: new Float32Array(capacity * 3),
      rotations: new Float32Array(capacity * 4),
      colors: new Uint8Array(capacity * 4),
      normals: new Float32Array(capacity * 4),
      drift: new Float32Array(capacity),
    };
  }

  get size(): number {
    return this.length;
  }

  get remaining(): number {
    return this.capacity - this.length;
  }

  push(splat: SplatInput): void {
    if (this.length >= this.capacity) throw new Error(`SplatBuilder is full (${this.capacity})`);
    const i = this.length++;
    const { positions, scales, rotations, colors, normals, drift } = this.cloud;
    drift[i] = splat.drift ?? 0;
    positions.set(splat.position, i * 3);
    scales.set(splat.scale, i * 3);
    const normal = normalize(splat.normal ?? [0, 0, 1]);
    normals.set(normal, i * 4);
    normals[i * 4 + 3] = Math.min(1, Math.max(0, splat.shading ?? 0));
    const q = quaternionFromNormal(normal, splat.tangent ?? [1, 0, 0]);
    rotations.set(q, i * 4);
    colors[i * 4] = toByte(splat.color[0]);
    colors[i * 4 + 1] = toByte(splat.color[1]);
    colors[i * 4 + 2] = toByte(splat.color[2]);
    colors[i * 4 + 3] = toByte(splat.opacity);
  }

  build(): SplatCloud {
    if (this.length !== this.capacity) {
      throw new Error(`SplatBuilder holds ${this.length} of ${this.capacity} splats`);
    }
    return this.cloud;
  }
}

function toByte(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

export function normalize(v: Vec3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Rotation whose local z axis is `normal` and local x axis is `tangent` (made orthogonal to
 * the normal). Returned as w, x, y, z.
 */
export function quaternionFromNormal(normal: Vec3, tangent: Vec3): [number, number, number, number] {
  const n = normalize(normal);
  const d = tangent[0] * n[0] + tangent[1] * n[1] + tangent[2] * n[2];
  let t: [number, number, number] = [tangent[0] - d * n[0], tangent[1] - d * n[1], tangent[2] - d * n[2]];
  if (Math.hypot(t[0], t[1], t[2]) < 1e-6) {
    t = Math.abs(n[0]) < 0.9 ? normalize(cross([1, 0, 0], n)) : normalize(cross([0, 1, 0], n));
    t = normalize(cross(t, n));
  }
  t = normalize(t);
  const b = cross(n, t);
  return quaternionFromBasis(t, b, n);
}

/** Quaternion (w, x, y, z) of the rotation matrix with columns x, y, z. */
export function quaternionFromBasis(x: Vec3, y: Vec3, z: Vec3): [number, number, number, number] {
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const trace = m00 + m11 + m22;
  let w: number, qx: number, qy: number, qz: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  const l = Math.hypot(w, qx, qy, qz);
  return [w / l, qx / l, qy / l, qz / l];
}

/**
 * Upper triangle of the covariance R·S·Sᵀ·Rᵀ: c00, c01, c02, c11, c12, c22.
 */
export function covariance(
  scale: ArrayLike<number>,
  scaleOffset: number,
  rotation: ArrayLike<number>,
  rotationOffset: number,
  out: Float32Array,
  outOffset: number,
): void {
  const w = rotation[rotationOffset]!, x = rotation[rotationOffset + 1]!;
  const y = rotation[rotationOffset + 2]!, z = rotation[rotationOffset + 3]!;
  const sx = scale[scaleOffset]!, sy = scale[scaleOffset + 1]!, sz = scale[scaleOffset + 2]!;
  // Rotation matrix rows.
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  // M = R·S
  const m00 = r00 * sx, m01 = r01 * sy, m02 = r02 * sz;
  const m10 = r10 * sx, m11 = r11 * sy, m12 = r12 * sz;
  const m20 = r20 * sx, m21 = r21 * sy, m22 = r22 * sz;
  out[outOffset] = m00 * m00 + m01 * m01 + m02 * m02;
  out[outOffset + 1] = m00 * m10 + m01 * m11 + m02 * m12;
  out[outOffset + 2] = m00 * m20 + m01 * m21 + m02 * m22;
  out[outOffset + 3] = m10 * m10 + m11 * m11 + m12 * m12;
  out[outOffset + 4] = m10 * m20 + m11 * m21 + m12 * m22;
  out[outOffset + 5] = m20 * m20 + m21 * m21 + m22 * m22;
}
