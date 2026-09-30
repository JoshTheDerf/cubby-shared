/**
 * `@cubby/shared/cad/manifold` — CubbyCAD's Manifold-3d helpers, shared with
 * Cubby Slicer. THREE-free and WASM-free: every function takes the Manifold
 * module (or its `Mesh`/`Manifold` classes) as an argument, so it runs on the
 * main thread, in a worker, or under Node.
 *
 *  - `manifoldComponents`: component-split mesh → Manifold ingest (keeps
 *    edge-touching voxel corners), tolerance-weld auto-repair, status checks.
 *  - `manifoldMesh`: numProp-6 (position + RGB) mesh data, subtraction
 *    expansion, float32-safe export.
 *  - `csgBatchCore`: the group boolean program (`runCsgBatch`) CubbyCAD's
 *    manifold worker runs; the shared evaluator runs the same code.
 */
export {
  splitByFaceConnectivity,
  buildComponentManifold,
  ingestMesh,
  buildGeneratedSolid,
  isErroredManifold,
  weldEpsilonFor,
  type MeshData,
} from './manifoldComponents';
export {
  MANIFOLD_NUM_PROP,
  expandManifoldSlightly,
  manifoldToMeshData,
  findCollapsedTriangle,
  manifoldToCleanMeshData,
  type ManifoldMeshData,
} from './manifoldMesh';
export {
  runCsgBatch,
  type MeshInlineInput,
  type CachedInput,
  type CsgInput,
  type CsgBatchInput,
  type CsgBatchOutput,
  type CsgBatchDeps,
} from './csgBatchCore';
