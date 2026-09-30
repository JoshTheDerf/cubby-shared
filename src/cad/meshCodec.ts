/**
 * The inline baked-mesh codec (CubbyCAD's `mesh` geometry): little-endian
 * base64 typed-array dumps plus a content hash. Moved from CubbyCAD
 * `geometry/bakeMesh.ts` (which keeps the THREE-side extraction and wraps
 * these for BufferGeometry).
 */

import type { MeshGeometry } from './geometry';
import type { MeshBuffers } from './schema';

// ── base64 ⇄ typed array (little-endian) ─────────────────────────────────────
// Chunked String.fromCharCode to stay under the argument-count limit, btoa/atob
// for the transport string.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function float32ToBase64(arr: Float32Array): string {
  return bytesToBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
}

export function base64ToFloat32(b64: string, count: number): Float32Array {
  const bytes = base64ToBytes(b64);
  // Copy into a fresh, aligned buffer (the decoded bytes may not be 4-aligned).
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + count * 4));
}

export function uint32ToBase64(arr: Uint32Array): string {
  return bytesToBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
}

export function base64ToUint32(b64: string, count: number): Uint32Array {
  const bytes = base64ToBytes(b64);
  return new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + count * 4));
}

/** Stable content hash of the baked payload — the cache/node-hash key. Two
 *  identical bakes hash equal (so they share a factory cache slot); any change
 *  to position/normal/colour/index flips it. FNV-1a over the COMPLETE base64
 *  strings (not a sample), with a separator between fields so a byte that
 *  shifts across the field boundary can't cancel out — a sampled hash would
 *  let two distinct meshes of equal vertex/index counts collide and silently
 *  render as each other (the id is also persisted in the scene JSON). Runs
 *  once per bake (a cold, user-triggered path), so hashing the full strings is
 *  affordable. Not cryptographic — collision is astronomically unlikely and
 *  would only mean a shared cache slot. */
export function meshContentHash(parts: Array<string | undefined>): string {
  let h = 0x811c9dc5;
  for (const s of parts) {
    if (s) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x1f; h = Math.imul(h, 0x01000193); // field separator
  }
  return 'm_' + (h >>> 0).toString(36);
}

/** Encode render-frame triangle buffers as an inline `mesh` geometry.
 *  `normals` is required by the format (CubbyCAD renders them); pass
 *  `computeFlatNormals` output when the source has none. `colors` is persisted
 *  only when given. */
export function encodeMeshBuffers(
  buffers: MeshBuffers & { normals: Float32Array },
  name?: string,
): MeshGeometry {
  const vertexCount = buffers.positions.length / 3;
  let indexCount: number | undefined;
  let indexB64: string | undefined;
  if (buffers.indices) {
    indexCount = buffers.indices.length;
    indexB64 = uint32ToBase64(buffers.indices);
  }
  const positionB64 = float32ToBase64(buffers.positions);
  const normalB64 = float32ToBase64(buffers.normals);
  const colorB64 = buffers.colors ? float32ToBase64(buffers.colors) : undefined;
  // Hash the COMPLETE encoded payload (not a sample) so distinct meshes never
  // collide on the cache/node-hash key.
  const id = meshContentHash([positionB64, normalB64, colorB64, indexB64]);

  const data: MeshGeometry['data'] = {
    vertexCount,
    position: positionB64,
    normal: normalB64,
  };
  if (colorB64) data.color = colorB64;
  if (indexB64) { data.index = indexB64; data.indexCount = indexCount; }

  return { type: 'mesh', id, name, data };
}

/** Decode an inline `mesh` geometry to render-frame (Y-up) buffers. */
export function decodeMeshBuffers(geom: MeshGeometry): MeshBuffers {
  const { data } = geom;
  const out: MeshBuffers = {
    positions: base64ToFloat32(data.position, data.vertexCount * 3),
  };
  if (data.normal) out.normals = base64ToFloat32(data.normal, data.vertexCount * 3);
  if (data.color) out.colors = base64ToFloat32(data.color, data.vertexCount * 3);
  if (data.index && data.indexCount) out.indices = base64ToUint32(data.index, data.indexCount);
  return out;
}

/** Per-vertex flat normals for a triangle soup (each corner gets its face's
 *  normal; indexed vertices take the last face that touches them — use a
 *  non-indexed mesh for exact faceting). */
export function computeFlatNormals(positions: Float32Array, indices?: Uint32Array): Float32Array {
  const out = new Float32Array(positions.length);
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    const a = indices ? indices[t * 3] : t * 3;
    const b = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const c = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [a, b, c]) { out[v * 3] = nx; out[v * 3 + 1] = ny; out[v * 3 + 2] = nz; }
  }
  return out;
}
