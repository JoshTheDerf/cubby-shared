/**
 * Shared Manifold-mesh helpers used on BOTH the main thread and the
 * CSG/mesh workers — keep this module THREE-free and dependency-light so
 * the worker bundles stay small.
 *
 * These existed as per-file copies (main-thread `manifoldComposition` vs
 * `manifoldWorker/worker`) that had to be kept in sync by hand; any fix
 * to the expansion epsilon or the copy semantics now lands in one place.
 */

import { buildComponentManifold, isErroredManifold } from './manifoldComponents';

/** Vertex-property stride for the colour-carrying CSG pipeline:
 *  position (3) + RGB (3). Manifold linearly interpolates the extra
 *  properties at vertices created on boolean cut edges, which is what
 *  preserves per-component colour through unions/differences. */
export const MANIFOLD_NUM_PROP = 6;

export interface ManifoldMeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}

/** Scale a manifold about its own centre by a hair so a coincident-face
 *  subtraction reliably punches through instead of leaving a
 *  zero-thickness shell. Pure — returns a new manifold; the caller owns
 *  (and must eventually `delete()`) both. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function expandManifoldSlightly(manifold: any): any {
  const epsilon = 1.0000001;
  const bbox = manifold.boundingBox();
  const cx = ((bbox.min[0] ?? 0) + (bbox.max[0] ?? 0)) / 2;
  const cy = ((bbox.min[1] ?? 0) + (bbox.max[1] ?? 0)) / 2;
  const cz = ((bbox.min[2] ?? 0) + (bbox.max[2] ?? 0)) / 2;
  return manifold
    .translate([-cx, -cy, -cz])
    .scale(epsilon)
    .translate([cx, cy, cz]);
}

/** Copy a Manifold's mesh out to standalone MeshData buffers. The copies
 *  are safe to transfer to/from a worker or hold past the manifold's
 *  `delete()` — they never alias WASM memory. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function manifoldToMeshData(m: any): ManifoldMeshData {
  const mesh = m.getMesh();
  return {
    vertProperties: new Float32Array(mesh.vertProperties),
    triVerts: new Uint32Array(mesh.triVerts),
    numProp: mesh.numProp ?? MANIFOLD_NUM_PROP,
  };
}

/** Index of the first triangle with two corners on the SAME float32 position
 *  (a zero-area triangle whose collapsed edge welds into a non-manifold edge
 *  in any position-welding consumer: STL, slicers, `splitByFaceConnectivity`),
 *  or -1 when there is none. Compares positions, not indices, because MeshGL
 *  splits a vertex into several indices wherever its properties differ. */
export function findCollapsedTriangle(d: ManifoldMeshData): number {
  const { vertProperties: vp, triVerts: tv, numProp: np } = d;
  const same = (a: number, b: number) => {
    const oa = a * np, ob = b * np;
    return vp[oa] === vp[ob] && vp[oa + 1] === vp[ob + 1] && vp[oa + 2] === vp[ob + 2];
  };
  for (let t = 0; t < tv.length; t += 3) {
    const a = tv[t], b = tv[t + 1], c = tv[t + 2];
    if (same(a, b) || same(b, c) || same(c, a)) return t / 3;
  }
  return -1;
}

/**
 * {@link manifoldToMeshData} for a boolean RESULT that leaves the CSG
 * pipeline (display, STL/3MF export, a parent group's re-import).
 *
 * Manifold computes in double precision, but `getMesh()` exports float32. A
 * boolean over nearly-coincident coplanar geometry (e.g. a union of stacked
 * cylinders whose flush caps overlap and whose fan-hub vertices sit on each
 * other's cap edges) can legitimately keep distinct vertices only ~1e-7 mm
 * apart — below Manifold's merge tolerance but never collapsed, since Manifold
 * guarantees topology, not non-degeneracy. Rounded to float32 at coordinates of
 * tens of mm (ulp ≈ 4e-6), those vertices land on the same point: the exported
 * mesh gains zero-area triangles, and anything that welds by position sees
 * edges shared by 4 triangles.
 *
 * So when the float32 copy has a collapsed triangle, feed that float32 mesh
 * back through Manifold's own constructor (via `buildComponentManifold`, which
 * merges within tolerance and drops the degenerates) and export again: the result is valid AT the precision it is
 * handed on in. Clean meshes (the overwhelming majority) pay one linear scan.
 * Falls back to the plain copy if the rebuild does not yield a clean, valid,
 * non-empty solid, so this never does worse than before.
 */
export function manifoldToCleanMeshData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wasm: { Mesh: any; Manifold: any },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m: any,
): ManifoldMeshData {
  const data = manifoldToMeshData(m);
  if (findCollapsedTriangle(data) < 0) return data;
  let current = data;
  // Two passes at most: one rebuild settles every case seen so far; the second
  // guards against a weld exposing a fresh coincidence.
  for (let pass = 0; pass < 2; pass++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rebuilt: any = null;
    try {
      // The same ingest a parent group applies to a child's mesh (component
      // split first, so an edge-touching voxel pinch is not welded shut).
      rebuilt = buildComponentManifold(wasm, current);
      if (!rebuilt || isErroredManifold(rebuilt) || rebuilt.isEmpty?.()) return data;
      const next = manifoldToMeshData(rebuilt);
      if (!next.triVerts.length) return data;
      if (findCollapsedTriangle(next) < 0) return next;
      current = next;
    } catch {
      return data;
    } finally {
      try { rebuilt?.delete?.(); } catch { /* noop */ }
    }
  }
  return data;
}
