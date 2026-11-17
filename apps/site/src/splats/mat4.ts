// Minimal column-major 4×4 matrices (the WebGL layout).

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      r[c * 4 + row] =
        a[row]! * b[c * 4]! + a[4 + row]! * b[c * 4 + 1]! + a[8 + row]! * b[c * 4 + 2]! + a[12 + row]! * b[c * 4 + 3]!;
    }
  }
  out.set(r);
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function scaling(s: number): Mat4 {
  const m = identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

export function rotationX(a: number): Mat4 {
  const m = identity();
  const c = Math.cos(a), s = Math.sin(a);
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotationY(a: number): Mat4 {
  const m = identity();
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotationZ(a: number): Mat4 {
  const m = identity();
  const c = Math.cos(a), s = Math.sin(a);
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

/** Product of the matrices, applied right to left (the last one first). */
export function compose(...matrices: Mat4[]): Mat4 {
  return matrices.reduce((acc, m) => multiply(acc, m), identity());
}

/**
 * Perspective projection. `shiftX`/`shiftY` move the image in normalized device coordinates
 * (a lens shift), so the subject can sit beside the text without turning the camera.
 */
export function perspective(fovY: number, aspect: number, near: number, far: number, shiftX = 0, shiftY = 0): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[8] = -shiftX;
  m[9] = -shiftY;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(eye: readonly number[], target: readonly number[], up: readonly number[] = [0, 1, 0]): Mat4 {
  let zx = eye[0]! - target[0]!, zy = eye[1]! - target[1]!, zz = eye[2]! - target[2]!;
  let l = Math.hypot(zx, zy, zz);
  zx /= l; zy /= l; zz /= l;
  let xx = up[1]! * zz - up[2]! * zy, xy = up[2]! * zx - up[0]! * zz, xz = up[0]! * zy - up[1]! * zx;
  l = Math.hypot(xx, xy, xz);
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0]! + xy * eye[1]! + xz * eye[2]!);
  m[13] = -(yx * eye[0]! + yy * eye[1]! + yz * eye[2]!);
  m[14] = -(zx * eye[0]! + zy * eye[1]! + zz * eye[2]!);
  m[15] = 1;
  return m;
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}
