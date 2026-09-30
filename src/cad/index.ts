/**
 * `@cubby/shared/cad` — CubbyCAD's modelling core, shared with Cubby Slicer:
 * the `.cubby` node types, the built-in shape registry (every Manifold-built
 * primitive), an evaluator with CubbyCAD's manifold-group semantics, pure
 * tree operations (create / group / ungroup / holes) and transform math.
 *
 * Manifold is never imported here: callers pass an initialised module
 * (`const wasm = await Module(); wasm.setup()`). Manifold helpers and the CSG
 * batch program live in `@cubby/shared/cad/manifold`; Vue components in
 * `@cubby/shared/cad/ui`.
 */
export * from './types';
export type { ManifoldWasm } from './wasm';
export * from './geometry';
export * from './schema';
export * from './shapes';
export * from './meshCodec';
export * from './colors';
export * from './i18n';
export * as sdf from './sdf/primitives';
export type { Vec3 } from './sdf/types';
