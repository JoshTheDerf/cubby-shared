/**
 * Component-split Manifold construction.
 *
 * Two voxels that touch only along an edge or corner (a diagonal +x→+z
 * staircase, a VBV/BVB/VBV checkerboard, a sloped voxel flush against a flat
 * one) produce a non-manifold "pinch" edge — four triangles sharing one edge —
 * in the single merged mesh a voxel part bakes to. The raw triangles are
 * geometrically perfect (correct winding, correct volume), but when that one
 * mesh is handed to Manifold, its construction welds the count-4 pinch edge and
 * then deterministically collapses one diagonal of it, slicing the shared
 * corner away (always the same direction — it's symbolic-perturbation
 * tie-breaking, not precision). This is why the artifact showed up only after
 * CSG grouping, affected both the cube2 and plain-voxel meshers, and was
 * independent of voxel size.
 *
 * The fix: split the mesh into components connected only across MANIFOLD edges
 * (edges shared by exactly two triangles), treating the non-manifold pinch
 * edges as component boundaries, then `union` the components. Manifold unions
 * edge-touching solids correctly, so every corner survives. A clean watertight
 * solid has no non-manifold edges, so it stays a single component and this is a
 * no-op (one component → no boolean) — only genuinely pinched meshes pay any
 * cost, and only at bake time.
 *
 * Both the off-thread worker and the main-thread CSGProcessor build Manifolds
 * from raw geometry, so both go through here.
 */

export interface MeshData { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number }

/**
 * Split an interleaved triangle mesh into components connected only across
 * edges shared by exactly two triangles. Vertices are welded by exact
 * position (the shared-edge verts these meshers emit are bit-identical), so a
 * non-manifold edge — where four (or more) triangles meet — separates the
 * solids that meet there. Non-position props (e.g. RGB at numProp 6) are
 * carried through per vertex. Returns one entry per component.
 */
export function splitByFaceConnectivity(
  vp: Float32Array, tv: Uint32Array, numProp: number,
): MeshData[] {
  const vertCount = numProp > 0 ? Math.floor(vp.length / numProp) : 0;
  const triCount = Math.floor(tv.length / 3);
  if (triCount === 0) return [];

  // Weld by exact position → canonical vertex id.
  const canon = new Int32Array(vertCount);
  const keyToId = new Map<string, number>();
  for (let i = 0; i < vertCount; i++) {
    const o = i * numProp;
    const k = `${vp[o]},${vp[o + 1]},${vp[o + 2]}`;
    let id = keyToId.get(k);
    if (id === undefined) { id = keyToId.size; keyToId.set(k, id); }
    canon[i] = id;
  }

  // Map each undirected edge (by canonical ids) → incident triangles.
  const edgeMap = new Map<string, number[]>();
  const ekey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < triCount; t++) {
    const a = canon[tv[t * 3]], b = canon[tv[t * 3 + 1]], c = canon[tv[t * 3 + 2]];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = ekey(u, v);
      let arr = edgeMap.get(k);
      if (!arr) { arr = []; edgeMap.set(k, arr); }
      arr.push(t);
    }
  }

  // Union-find over triangles, joining only across 2-triangle (manifold) edges.
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const uni = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const tris of edgeMap.values()) {
    if (tris.length === 2) uni(tris[0], tris[1]);
  }

  // Group triangles by component root.
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    let arr = groups.get(r);
    if (!arr) { arr = []; groups.set(r, arr); }
    arr.push(t);
  }
  if (groups.size <= 1) {
    // Single component (the common case for clean solids): return the input
    // verbatim, no re-indexing.
    return [{ vertProperties: vp, triVerts: tv, numProp }];
  }

  // Re-index each component into its own compact buffers.
  const out: MeshData[] = [];
  for (const tris of groups.values()) {
    const remap = new Map<number, number>();
    const cvp: number[] = [];
    const ctv = new Uint32Array(tris.length * 3);
    let ti = 0;
    for (const t of tris) {
      for (let j = 0; j < 3; j++) {
        const orig = tv[t * 3 + j];
        let ni = remap.get(orig);
        if (ni === undefined) {
          ni = remap.size;
          remap.set(orig, ni);
          for (let p = 0; p < numProp; p++) cvp.push(vp[orig * numProp + p]);
        }
        ctv[ti++] = ni;
      }
    }
    out.push({ vertProperties: new Float32Array(cvp), triVerts: ctv, numProp });
  }
  return out;
}

/**
 * Build a Manifold from raw MeshData, splitting non-manifold pinch edges into
 * separate components and unioning them so edge-/corner-touching solids keep
 * their shared corners (see module docs). `wasm` must expose `Mesh` and
 * `Manifold`. Returns null only when nothing builds.
 *
 * All-or-nothing, because not every non-manifold edge is a clean separation.
 * A complex sloped / pushed-in cube2 voxel is closed only as a WHOLE — cutting
 * its non-manifold edges leaves OPEN component pieces (each connected, before
 * the cut, to a neighbour that split off into a different component), and
 * Manifold refuses open meshes. So: if EVERY component builds, union them (the
 * clean separable case — checkerboards, diagonal staircases — gets its corners
 * back); if ANY component fails, discard the partials and build the original
 * WHOLE mesh instead (exactly the pre-split behaviour, which renders complex
 * slopes). This never drops geometry the old single-mesh path kept, and never
 * does worse than it.
 */
export function buildComponentManifold(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wasm: { Mesh: any; Manifold: any },
  data: MeshData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const first = buildComponentManifoldRaw(wasm, data);
  if (first && !isErroredManifold(first)) return first;

  // CHEAP AUTO-REPAIR (tier 0): the most common non-manifold defect is shared
  // vertices left UN-merged by float-precision drift — every triangle keeps its
  // own copy, so edges aren't shared and the surface reads as non-manifold
  // (classic for STL, which stores no shared vertices at all). Rebuild with a
  // TOLERANCE vertex-merge (Manifold's own spatial weld) so those near-coincident
  // copies snap together into a closed solid. Runs ONLY on the failure path, so
  // a valid mesh never pays for it. Heavier repair (hole-fill / SDF remesh) is
  // the explicit one-click path.
  const repaired = buildWithToleranceMerge(wasm, data, weldEpsilonFor(data));
  if (repaired && !isErroredManifold(repaired)) {
    if (first) { try { first.delete?.(); } catch { /* noop */ } }
    return repaired;
  }
  if (repaired) { try { repaired.delete?.(); } catch { /* noop */ } }
  return first;
}

/**
 * THE mesh→Manifold ingest choke point for callers that need a USABLE solid or
 * nothing. Builds via the component-split + tier-0 tolerance-weld path
 * (`buildComponentManifold`) and then STATUS-CHECKS the result — Manifold-WASM
 * does not throw on bad input, it returns an error-status solid that meshes to
 * nothing, and feeding one into a boolean silently blanks the output. Returns
 * null (after freeing the errored handle, with a console.warn naming `label`)
 * so callers can't accidentally cache or compose an errored solid.
 */
export function ingestMesh(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wasm: { Mesh: any; Manifold: any },
  data: MeshData,
  label = 'mesh',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const solid = buildComponentManifold(wasm, data);
  if (!solid) return null;
  if (isErroredManifold(solid)) {
    console.warn(`[manifold] ${label}: mesh did not build into a valid solid (status ${safeStatus(solid)}); dropped.`);
    try { solid.delete?.(); } catch { /* noop */ }
    return null;
  }
  return solid;
}

/**
 * Bare construction for TRUSTED generator meshes (hand-built primitives like
 * the icosahedron/star/diamond shapes, the sweep walls+caps). Merges shared
 * vertices and warns loudly if the generator emitted a non-manifold mesh —
 * that's a code bug, not user data — but still returns the solid so the
 * caller's flow is unchanged (the downstream CSG gates catch the errored
 * handle; this warning just points at the culprit generator).
 */
export function buildGeneratedSolid(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wasm: { Mesh: any; Manifold: any },
  data: MeshData,
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const mesh = new wasm.Mesh({ numProp: data.numProp, vertProperties: data.vertProperties, triVerts: data.triVerts });
  mesh.merge();
  const solid = new wasm.Manifold(mesh);
  if (isErroredManifold(solid)) {
    console.warn(`[manifold] generated ${label} is not a valid solid (status ${safeStatus(solid)}) — generator bug.`);
  }
  return solid;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeStatus(m: any): string {
  try { return String(m.status?.()); } catch { return 'unknown'; }
}

/** Rebuild a Manifold with a TOLERANCE vertex-merge: Manifold's own spatial weld
 *  snaps vertices within `epsilon` together, re-sharing edges that float drift
 *  split apart. The tier-0 auto-repair for a non-manifold input. Returns null on
 *  failure (caller keeps the original result). */
function buildWithToleranceMerge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wasm: { Mesh: any; Manifold: any },
  data: MeshData,
  epsilon: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!data.triVerts.length) return null;
  try {
    const mesh = new wasm.Mesh({ numProp: data.numProp, vertProperties: data.vertProperties, triVerts: data.triVerts });
    mesh.tolerance = epsilon;
    mesh.merge();
    return new wasm.Manifold(mesh);
  } catch {
    return null;
  }
}

/** The raw component-split build (no auto-repair). Wrapped by
 *  `buildComponentManifold`, which retries this on a welded mesh when it fails. */
function buildComponentManifoldRaw(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wasm: { Mesh: any; Manifold: any },
  data: MeshData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const { Mesh, Manifold } = wasm;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildOne = (d: MeshData): any => {
    const mesh = new Mesh({ numProp: d.numProp, vertProperties: d.vertProperties, triVerts: d.triVerts });
    mesh.merge();
    return new Manifold(mesh);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whole = (): any => { try { return buildOne(data); } catch { return null; } };

  if (!data.triVerts.length) return null;
  const components = splitByFaceConnectivity(data.vertProperties, data.triVerts, data.numProp);
  if (components.length <= 1) return whole(); // single component (clean solid)

  // Try to build EVERY component. If one isn't independently closed (complex
  // slope), the split is unsafe for this mesh → free partials, build whole.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const built: any[] = [];
  for (const c of components) {
    let m;
    try { m = buildOne(c); }
    catch {
      // A component that isn't an independently-closed manifold (a complex
      // sloped/pushed cell) forces a whole-mesh rebuild — see the doc comment.
      for (const b of built) { try { b.delete?.(); } catch { /* noop */ } }
      return whole();
    }
    built.push(m);
  }
  if (built.length === 1) return built[0];

  const unioned = Manifold.union(built);
  // Free the per-component intermediates; the union owns its own data.
  for (const m of built) { try { m.delete?.(); } catch { /* noop */ } }
  return unioned;
}

/**
 * True when a Manifold carries a non-`NoError` status. Manifold-WASM does NOT
 * throw on non-manifold input — `new Manifold(badMesh)` returns an error-status
 * solid that meshes to nothing — so a status check is the only way to detect a
 * non-manifold child instead of silently serialising empty geometry. The CSG
 * worker uses this to flag a failed batch (→ warning banner + un-unioned
 * fallback on the main thread). Conservative on the unknown: a missing or
 * throwing `status()` is treated as OK so a valid group is never falsely
 * failed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isErroredManifold(m: any): boolean {
  try {
    if (typeof m?.status !== 'function') return false;
    return String(m.status()) !== 'NoError';
  } catch {
    return false;
  }
}

/** Weld tolerance for the auto-repair pass: relative to the mesh extent so it
 *  scales with model size, clamped to a sane absolute band. Big enough to merge
 *  float-precision-split shared vertices, small enough to leave real detail. */
export function weldEpsilonFor(data: MeshData): number {
  const vp = data.vertProperties, np = data.numProp;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vp.length; i += np) {
    const x = vp[i], y = vp[i + 1], z = vp[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(diag) || diag <= 0) return 1e-5;
  return Math.min(1e-2, Math.max(1e-6, diag * 1e-5));
}
