/**
 * Node-transform matrix math without three.js: 16-float COLUMN-MAJOR arrays
 * (the layout of `THREE.Matrix4.elements` and of Manifold's `transform()`),
 * plain doubles. `composeMatrix` / `decomposeMatrix` / `multiplyMatrices` are
 * line-for-line ports of three r182's `Matrix4.compose` / `decompose` /
 * `multiplyMatrices` (+ `Quaternion.setFromRotationMatrix`) so CubbyCAD's
 * group/ungroup transform baking produces bit-identical results through them.
 */

import type { CadTransform } from './types';

export type Mat4 = number[];
export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export function identityMatrix(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** T·R·S from position, quaternion [x, y, z, w] and scale (three's `compose`). */
export function composeMatrix(p: Vec3Tuple, q: QuatTuple, s: Vec3Tuple): Mat4 {
  const te = new Array<number>(16);
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  te[0] = (1 - (yy + zz)) * sx;
  te[1] = (xy + wz) * sx;
  te[2] = (xz - wy) * sx;
  te[3] = 0;
  te[4] = (xy - wz) * sy;
  te[5] = (1 - (xx + zz)) * sy;
  te[6] = (yz + wx) * sy;
  te[7] = 0;
  te[8] = (xz + wy) * sz;
  te[9] = (yz - wx) * sz;
  te[10] = (1 - (xx + yy)) * sz;
  te[11] = 0;
  te[12] = p[0];
  te[13] = p[1];
  te[14] = p[2];
  te[15] = 1;
  return te;
}

export function determinant(te: Mat4): number {
  const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12];
  const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
  const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14];
  const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
  const t11 = n23 * n34 - n24 * n33;
  const t12 = n22 * n34 - n24 * n32;
  const t13 = n22 * n33 - n23 * n32;
  const t21 = n21 * n34 - n24 * n31;
  const t22 = n21 * n33 - n23 * n31;
  const t23 = n21 * n32 - n22 * n31;
  return n11 * (n42 * t11 - n43 * t12 + n44 * t13)
    - n12 * (n41 * t11 - n43 * t21 + n44 * t22)
    + n13 * (n41 * t12 - n42 * t21 + n44 * t23)
    - n14 * (n41 * t13 - n42 * t22 + n43 * t23);
}

function quatFromRotationMatrix(te: Mat4): QuatTuple {
  const m11 = te[0], m12 = te[4], m13 = te[8];
  const m21 = te[1], m22 = te[5], m23 = te[9];
  const m31 = te[2], m32 = te[6], m33 = te[10];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/** Position, quaternion and scale of a TRS matrix (three's `decompose`: a
 *  negative determinant flips the X scale; a singular matrix yields identity
 *  rotation and unit scale). */
export function decomposeMatrix(te: Mat4): { position: Vec3Tuple; rotation: QuatTuple; scale: Vec3Tuple } {
  const position: Vec3Tuple = [te[12], te[13], te[14]];
  if (determinant(te) === 0) {
    return { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
  }
  let sx = Math.sqrt(te[0] * te[0] + te[1] * te[1] + te[2] * te[2]);
  const sy = Math.sqrt(te[4] * te[4] + te[5] * te[5] + te[6] * te[6]);
  const sz = Math.sqrt(te[8] * te[8] + te[9] * te[9] + te[10] * te[10]);
  if (determinant(te) < 0) sx = -sx;
  const m = te.slice();
  const invSX = 1 / sx, invSY = 1 / sy, invSZ = 1 / sz;
  m[0] *= invSX; m[1] *= invSX; m[2] *= invSX;
  m[4] *= invSY; m[5] *= invSY; m[6] *= invSY;
  m[8] *= invSZ; m[9] *= invSZ; m[10] *= invSZ;
  return { position, rotation: quatFromRotationMatrix(m), scale: [sx, sy, sz] };
}

/** a · b (three's `multiplyMatrices`). */
export function multiplyMatrices(ae: Mat4, be: Mat4): Mat4 {
  const te = new Array<number>(16);
  const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
  const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
  const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
  const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
  const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
  const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
  const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
  const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
  te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
  return te;
}

/** Inverse of a 4×4 (three's `invert`); the zero matrix when singular. */
export function invertMatrix(te: Mat4): Mat4 {
  const n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3];
  const n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7];
  const n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11];
  const n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (det === 0) return new Array<number>(16).fill(0);
  const d = 1 / det;
  const out = new Array<number>(16);
  out[0] = t11 * d;
  out[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
  out[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
  out[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
  out[4] = t12 * d;
  out[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
  out[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
  out[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
  out[8] = t13 * d;
  out[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
  out[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
  out[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
  out[12] = t14 * d;
  out[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
  out[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
  out[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
  return out;
}

/** A node transform as a matrix (identity for an absent transform) — CubbyCAD's
 *  `composeTransformMatrix`. */
export function transformToMatrix(t?: CadTransform): Mat4 {
  if (!t) return identityMatrix();
  return composeMatrix(
    [t.position?.[0] ?? 0, t.position?.[1] ?? 0, t.position?.[2] ?? 0],
    [t.rotation?.[0] ?? 0, t.rotation?.[1] ?? 0, t.rotation?.[2] ?? 0, t.rotation?.[3] ?? 1],
    [t.scale?.[0] ?? 1, t.scale?.[1] ?? 1, t.scale?.[2] ?? 1],
  );
}

/** The full decomposed transform of a matrix — CubbyCAD's `decomposeMatrix`. */
export function matrixToTransform(m: Mat4): Required<CadTransform> {
  return decomposeMatrix(m);
}

/** Render frame (Y-up, CubbyCAD) → Z-up world (the slicer): +90° about X,
 *  mapping render (x, y, z) to (x, −z, y). Apply once at the root. */
export const RENDER_TO_ZUP: Mat4 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

/** Z-up → render frame (the inverse of {@link RENDER_TO_ZUP}). */
export const ZUP_TO_RENDER: Mat4 = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

/** Transform packed xyz positions in place by `m`. */
export function transformPositions(positions: Float32Array, m: Mat4): Float32Array {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    positions[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return positions;
}

// ── quaternions & transform edits ────────────────────────────────────────────

/** Quaternion [x, y, z, w] of an XYZ-order Euler rotation in radians (three's
 *  `Quaternion.setFromEuler` for order 'XYZ'). */
export function quatFromEulerXYZ(x: number, y: number, z: number): QuatTuple {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** a · b (three's `multiplyQuaternions`). */
export function multiplyQuaternions(a: QuatTuple, b: QuatTuple): QuatTuple {
  const [qax, qay, qaz, qaw] = a;
  const [qbx, qby, qbz, qbw] = b;
  return [
    qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
    qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
    qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
    qaw * qbw - qax * qbx - qay * qby - qaz * qbz,
  ];
}

export interface TransformArgs {
  /** 'set' (default) replaces each given field; 'offset' moves by `position`,
   *  multiplies by `scale` and rotates by `rotationDeg` on top. */
  mode?: 'set' | 'offset';
  position?: number[];
  /** XYZ Euler rotation in degrees. */
  rotationDeg?: number[];
  scale?: number[];
}

/**
 * The transform CubbyCAD's `transform_node` produces (ai/host `transformNode`):
 * missing fields keep their current value; length-3 arrays apply. Always
 * returns all three fields.
 */
export function applyTransformArgs(t: CadTransform | undefined, a: TransformArgs): Required<CadTransform> {
  const mode = a.mode ?? 'set';
  const oldPos = [...(t?.position ?? [0, 0, 0])] as Vec3Tuple;
  const oldRot = [...(t?.rotation ?? [0, 0, 0, 1])] as QuatTuple;
  const oldScale = [...(t?.scale ?? [1, 1, 1])] as Vec3Tuple;
  const position: Vec3Tuple = [...oldPos];
  let rotation: QuatTuple = [...oldRot];
  const scale: Vec3Tuple = [...oldScale];
  if (a.position && a.position.length === 3) {
    for (let i = 0; i < 3; i++) position[i] = mode === 'offset' ? oldPos[i] + a.position[i] : a.position[i];
  }
  if (a.scale && a.scale.length === 3) {
    for (let i = 0; i < 3; i++) scale[i] = mode === 'offset' ? oldScale[i] * a.scale[i] : a.scale[i];
  }
  if (a.rotationDeg && a.rotationDeg.length === 3) {
    const d2r = Math.PI / 180;
    const q = quatFromEulerXYZ(a.rotationDeg[0] * d2r, a.rotationDeg[1] * d2r, a.rotationDeg[2] * d2r);
    // Offset composes the delta rotation onto the current orientation.
    rotation = mode === 'offset' ? multiplyQuaternions(q, oldRot) : q;
  }
  return { position, rotation, scale };
}
