/**
 * The Manifold-3d surface CubbyCAD's shape builders and CSG code use, typed
 * by hand so this module doesn't pull `manifold-3d` in (the app owns the WASM
 * instance and passes it in: `const wasm = await Module(); wasm.setup()`).
 * Moved from CubbyCAD `types/wasm.ts`.
 */
export interface ManifoldWasm {
  Manifold: typeof Manifold;
  Mesh: typeof Mesh;
  CrossSection: typeof CrossSection;
  setup: () => void;
}

declare class Manifold {
  constructor(mesh: Mesh);
  static union(a: Manifold, b: Manifold): Manifold;
  static union(manifolds: readonly Manifold[]): Manifold;
  static difference(a: Manifold, b: Manifold): Manifold;
  static intersection(a: Manifold, b: Manifold): Manifold;
  static revolve(crossSection: CrossSection, circularSegments?: number, revolveDegrees?: number): Manifold;
  static cylinder(height: number, radiusLow: number, radiusHigh?: number, circularSegments?: number, center?: boolean): Manifold;
  static cube(size?: [number, number, number] | number, center?: boolean): Manifold;
  static sphere(radius: number, circularSegments?: number): Manifold;
  static hull(manifolds: Manifold[]): Manifold;
  /** Concatenate DISJOINT manifolds into one (no boolean — the parts must not overlap). */
  static compose(manifolds: readonly Manifold[]): Manifold;
  /** Split into connected components. */
  decompose(): Manifold[];
  volume(): number;
  genus(): number;
  numTri(): number;
  getMesh(): Mesh;
  boundingBox(): { min: [number, number, number]; max: [number, number, number] };
  /** 16-entry column-major matrix. Pass plain numbers (doubles): a
   *  Float32Array is accepted but rounds the transform before the boolean. */
  transform(matrix: ArrayLike<number>): Manifold;
  translate(offset: [number, number, number]): Manifold;
  rotate(angles: [number, number, number]): Manifold;
  scale(scale: [number, number, number]): Manifold;
  merge(): Manifold;
  /** Free WASM memory. Manifold instances cannot be garbage-collected. */
  delete(): void;
}

declare class Mesh {
  constructor(params: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array });
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  merge(): void;
}

declare class CrossSection {
  constructor(points: number[][][]);
  static square(size: [number, number], center: boolean): CrossSection;
  static circle(radius: number, segments: number): CrossSection;
  extrude(
    height: number,
    nDivisions?: number,
    twistDegrees?: number,
    scaleTop?: [number, number] | number,
    center?: boolean,
  ): Manifold;
}
