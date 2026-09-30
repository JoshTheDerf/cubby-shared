/**
 * The CSG batch program — framework-free, runnable anywhere Manifold-3d is.
 *
 * Extracted from the manifold worker so the batch logic stays independent of
 * the worker host. The only host-specific bits — the Manifold WASM classes and the per-host handle
 * cache — are passed in via `CsgBatchDeps`, so this module imports no WASM, no
 * THREE, no DOM.
 *
 * See the worker header for the protocol: a batch is one group's full CSG plan
 * (inputs as inline MeshData or cached handles, addition/subtraction indices,
 * an expand-subtractions flag, and a retain list). The handle cache holds only
 * un-transformed input Manifolds; per-batch transforms are applied fresh.
 */

import { buildComponentManifold, isErroredManifold } from './manifoldComponents';
import { expandManifoldSlightly, manifoldToCleanMeshData, manifoldToMeshData, MANIFOLD_NUM_PROP } from './manifoldMesh';

export interface MeshInlineInput {
  kind: 'mesh';
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
  /** Optional 16-float column-major transform applied before the CSG. */
  transform?: number[];
  /** Cache the un-transformed Manifold under this handle for later batches. */
  saveAs?: string;
}
export interface CachedInput {
  kind: 'cached';
  handle: string;
  transform?: number[];
}
export type CsgInput = MeshInlineInput | CachedInput;

export interface CsgBatchInput {
  inputs: CsgInput[];
  additionIndices: number[];
  subtractionIndices: number[];
  expandSubtractions: boolean;
  retainHandles: string[];
  /** Handle-namespace prefix of the SceneBuilder that owns this batch. When
   *  set, eviction only touches handles under this prefix — several builders
   *  (the live document + throwaway part-ref bakers) share one worker pool, and
   *  without scoping each batch wiped every OTHER builder's cached children
   *  (→ missingHandles → retry churn / partial results). Absent = legacy
   *  global eviction. */
  handleScope?: string;
}

export interface CsgBatchOutput {
  vertProperties: Float32Array | null;
  triVerts: Uint32Array | null;
  numProp: number;
  ghosts: Array<{ vertProperties: Float32Array; triVerts: Uint32Array; numProp: number }>;
  failed: boolean;
  failedInputs: number[];
  missingHandles: number[];
}

export interface CsgBatchDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Mesh: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Manifold: any;
  /** Handle → un-transformed Manifold. Survives across batches; the caller owns
   *  its lifetime (one per worker / per server runtime). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: Map<string, any>;
}

/** Drop every cached Manifold whose handle isn't in `retain` — restricted to
 *  handles under `scope` when one is given (other builders' entries survive). */
function evictCache(cache: CsgBatchDeps['cache'], retain: string[], scope?: string): void {
  const keep = new Set(retain);
  for (const [handle, m] of cache) {
    if (keep.has(handle)) continue;
    if (scope && !handle.startsWith(scope)) continue;
    try { m.delete?.(); } catch { /* noop */ }
    cache.delete(handle);
  }
}

export function runCsgBatch(deps: CsgBatchDeps, batch: CsgBatchInput): CsgBatchOutput {
  const { Mesh, Manifold, cache } = deps;
  // Evict any cached handles not in the retain list BEFORE we look up cached
  // inputs — so a stale entry under the same handle can't be resurrected if
  // main forgot to retain it.
  evictCache(cache, batch.retainHandles, batch.handleScope);

  // Track every Manifold we allocate so we can delete the intermediates on
  // exit. Cached input Manifolds (the values stored in `cache`) are OMITTED —
  // they survive the batch and stay valid for the next call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allManifolds: any[] = [];

  // Indices of `cached` inputs whose handle wasn't in the cache. Reported back
  // so the main thread can clear the stale handle and re-ship inline.
  const missingHandles: number[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builtInputs: Array<any | null> = batch.inputs.map((inp, idx) => {
    if (inp.kind === 'cached') {
      const stored = cache.get(inp.handle);
      if (!stored) {
        missingHandles.push(idx);
        return null;
      }
      if (inp.transform && inp.transform.length === 16) {
        // Pass the transform as plain doubles — see the inline branch below.
        const t = stored.transform(inp.transform);
        allManifolds.push(t);
        return t;
      }
      // No transform → still produce a distinct Manifold so we don't union the
      // cached object with itself or delete it during intermediate cleanup.
      const identity = new Float32Array(16);
      identity[0] = identity[5] = identity[10] = identity[15] = 1;
      const t = stored.transform(identity);
      allManifolds.push(t);
      return t;
    }
    if (!inp.triVerts.length) return null;
    // Build via the component-split path so voxels touching only along an
    // edge/corner keep their shared corner instead of Manifold collapsing the
    // count-4 pinch edge. A clean watertight solid is one component → no-op.
    const base = buildComponentManifold({ Mesh, Manifold }, {
      vertProperties: inp.vertProperties,
      triVerts: inp.triVerts,
      numProp: inp.numProp,
    });
    if (!base) return null;
    let working = base;
    if (inp.transform && inp.transform.length === 16) {
      // Keep the matrix in DOUBLE precision (Manifold's Mat4 is a plain number
      // tuple). Rounding it to Float32Array first shifted each child by up to
      // ~4e-6 mm at 60 mm from the origin and perturbed rotations by ~1e-7, so
      // faces and edges that are flush/collinear in the model (stacked cylinder
      // caps, a lobe's fan hub on the centre disc's cap edge) went NEARLY
      // coincident instead — and the boolean filled the gap with sliver and
      // zero-area triangles (the scalloped-coin STL defect).
      working = base.transform(inp.transform);
      allManifolds.push(working);
    }
    if (inp.saveAs) {
      const prev = cache.get(inp.saveAs);
      if (prev) { try { prev.delete?.(); } catch { /* noop */ } }
      cache.set(inp.saveAs, base);
    } else {
      allManifolds.push(base);
    }
    return working;
  });

  const failedInputs: number[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any | null = null;
  for (const idx of batch.additionIndices) {
    const child = builtInputs[idx];
    if (!child) continue;
    if (isErroredManifold(child)) { failedInputs.push(idx); continue; }
    if (!result) { result = child; continue; }
    const u = Manifold.union(result, child);
    allManifolds.push(u);
    result = u;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ghosts: any[] = [];
  if (result) {
    for (const idx of batch.subtractionIndices) {
      const child = builtInputs[idx];
      if (!child) { ghosts.push(null); continue; }
      if (isErroredManifold(child)) { failedInputs.push(idx); ghosts.push(null); continue; }
      const expanded = batch.expandSubtractions ? expandManifoldSlightly(child) : child;
      if (expanded !== child) allManifolds.push(expanded);
      ghosts.push(expanded);
      const d = Manifold.difference(result, expanded);
      allManifolds.push(d);
      result = d;
    }
  }

  // Valid inputs can still boolean into a non-manifold solid.
  let failed = failedInputs.length > 0;
  if (!failed && result && isErroredManifold(result)) failed = true;

  let finalVp: Float32Array | null = null;
  let finalTri: Uint32Array | null = null;
  let numProp = MANIFOLD_NUM_PROP;
  const ghostOutputs: CsgBatchOutput['ghosts'] = [];
  if (!failed && result) {
    // Float32-safe export: a result whose float32 copy collapses a triangle is
    // re-ingested so the mesh handed on (display, STL, parent re-import) is
    // manifold at the precision it travels in. See `manifoldToCleanMeshData`.
    const data = manifoldToCleanMeshData({ Mesh, Manifold }, result);
    finalVp = data.vertProperties;
    finalTri = data.triVerts;
    numProp = data.numProp;
    for (const g of ghosts) {
      if (!g) continue;
      ghostOutputs.push(manifoldToMeshData(g));
    }
  }

  // Free every intermediate Manifold so the WASM heap stays bounded.
  for (const m of allManifolds) {
    try { m.delete?.(); } catch { /* noop */ }
  }

  return { vertProperties: finalVp, triVerts: finalTri, numProp, ghosts: ghostOutputs, failed, failedInputs, missingHandles };
}
