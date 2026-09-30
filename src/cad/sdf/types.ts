/**
 * Shared types for analytic SDF composition + extraction. Kept free of
 * scene-graph dependencies so the per-group SDF CSG mode and any future
 * SDF-based feature can compose them without coupling to a particular
 * consumer.
 */

export interface Vec3 { x: number; y: number; z: number; }

/** Signed-distance sample callback. Negative inside, positive outside,
 *  in the same units the bounds are expressed in. Conventionally integer
 *  lattice units — the consumer multiplies by its cell size when emitting
 *  geometry. */
export type SdfSample = (x: number, y: number, z: number) => number;

/** Optional per-cell colour sampler. Returns linear-space RGB in [0, 1]
 *  for the cell whose lower corner sits at the integer
 *  coordinate, or `undefined` to fall back to the consumer's default
 *  colour. Extractors that receive one emit a `color` BufferAttribute;
 *  those that don't skip the attribute entirely. */
export type ColorSample = (x: number, y: number, z: number)
  => [number, number, number] | undefined;

/** Integer-lattice bounding box for an extractor's region of interest.
 *  The extractor walks one cell past each face so anything touching the
 *  boundary still produces sign-change quads. */
export interface SampleBounds {
  min: Vec3;
  max: Vec3;
}

/** Per-stroke combination mode shared between the discrete and analytic
 *  paths. Kept here so the booleans module needs no back-import. */
export type BoolMode = 'add' | 'subtract' | 'intersect';
