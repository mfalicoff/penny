// Encodes a cloud as a standard 3D Gaussian Splatting .ply (the INRIA layout most viewers and
// editors read: SuperSplat, Spark, gsplat.js…). Degree-0 spherical harmonics only.
import type { SplatCloud } from "./cloud.ts";

const SH_C0 = 0.28209479177387814;
const PROPERTIES = [
  "x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
  "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3",
] as const;

export function encodePly(cloud: SplatCloud): Uint8Array {
  const header =
    ["ply", "format binary_little_endian 1.0", `element vertex ${cloud.count}`]
      .concat(PROPERTIES.map((p) => `property float ${p}`), ["end_header"])
      .join("\n") + "\n";
  const head = new TextEncoder().encode(header);
  const stride = PROPERTIES.length * 4;
  const out = new Uint8Array(head.length + cloud.count * stride);
  out.set(head, 0);
  const view = new DataView(out.buffer, head.length);
  for (let i = 0; i < cloud.count; i++) {
    const values = [
      cloud.positions[i * 3]!, cloud.positions[i * 3 + 1]!, cloud.positions[i * 3 + 2]!,
      cloud.normals[i * 4]! / 127.5 - 1, cloud.normals[i * 4 + 1]! / 127.5 - 1, cloud.normals[i * 4 + 2]! / 127.5 - 1,
      (cloud.colors[i * 4]! / 255 - 0.5) / SH_C0,
      (cloud.colors[i * 4 + 1]! / 255 - 0.5) / SH_C0,
      (cloud.colors[i * 4 + 2]! / 255 - 0.5) / SH_C0,
      logit(cloud.colors[i * 4 + 3]! / 255),
      Math.log(cloud.scales[i * 3]!), Math.log(cloud.scales[i * 3 + 1]!), Math.log(cloud.scales[i * 3 + 2]!),
      cloud.rotations[i * 4]!, cloud.rotations[i * 4 + 1]!, cloud.rotations[i * 4 + 2]!, cloud.rotations[i * 4 + 3]!,
    ];
    values.forEach((v, k) => view.setFloat32(i * stride + k * 4, v, true));
  }
  return out;
}

function logit(p: number): number {
  const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return Math.log(q / (1 - q));
}
