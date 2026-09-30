/**
 * Parameter shapes of CubbyCAD's built-in (Manifold-built) geometry — moved
 * from CubbyCAD `types/geometry.ts`, which re-exports them. `params` holds the
 * editable values; structural fields (`type`, `pattern`, `id`, `data`) sit at
 * the top level so a param can't clobber them.
 *
 * Every built-in shape's params live under a nested `params` sub-object.
 * Legacy scenes saved with top-level params are migrated by CubbyCAD's
 * `SceneDataParser` at load time.
 */

export interface BoxGeometry {
  type: 'box';
  params: {
    width?: number;
    height?: number;
    depth?: number;
    bevel?: number;
    bevelSegments?: number;
  };
}

export interface CylinderGeometry {
  type: 'cylinder';
  params: {
    radius?: number;
    height?: number;
    radialSegments?: number;
    bevel?: number;
    bevelSegments?: number;
  };
}

/**
 * Concave corner fillet (cove): a square prism with a quarter-cylinder
 * carved out of one edge, leaving a rounded interior slope — exactly a
 * cylinder subtracted from a cube. Shares the cylinder's parameter set:
 * `radius` sizes BOTH the carving cylinder and the square cross-section
 * (side = radius), `height` is the length of the run, `radialSegments`
 * tessellates the arc, and `bevel`/`bevelSegments` round the rim of the
 * carving cylinder (ignored at the SDF level — see Cylinder/Box).
 */
export interface FilletGeometry {
  type: 'fillet';
  params: {
    radius?: number;
    height?: number;
    radialSegments?: number;
    bevel?: number;
    bevelSegments?: number;
  };
}

/**
 * Sphere-swept cone (IQ "round cone"): two spheres of independently
 * scalable radius joined by their external tangent surface. The bottom
 * sphere has radius `radius × bottomScale`, the top `radius × topScale`;
 * `height` is the distance BETWEEN the two sphere CENTERS (not the total
 * height). Y-up, bottom-snapped: the lowest point sits at y = 0, so the
 * bottom sphere centre is at y = rBottom and the top centre at
 * y = rBottom + height. Total height = rBottom + height + rTop.
 */
export interface CapsuleGeometry {
  type: 'capsule';
  params: {
    radius?: number;
    /** Distance between the two sphere centres. */
    height?: number;
    /** Top sphere radius = radius × topScale. */
    topScale?: number;
    /** Bottom sphere radius = radius × bottomScale. */
    bottomScale?: number;
    /** Radial (lathe) segments. */
    segments?: number;
  };
}

export interface ConeGeometry {
  type: 'cone';
  params: {
    radiusBottom?: number;
    radiusTop?: number;
    height?: number;
    radialSegments?: number;
  };
}

export interface SphereGeometry {
  type: 'sphere';
  params: {
    radius?: number;
    radialSegments?: number;
    verticalSegments?: number;
  };
}

export interface HalfSphereGeometry {
  type: 'halfSphere';
  params: {
    radius?: number;
    radialSegments?: number;
  };
}

export interface HalfCylinderGeometry {
  type: 'halfCylinder';
  params: {
    radius?: number;
    height?: number;
    depth?: number;
    radialSegments?: number;
  };
}

export interface TorusGeometry {
  type: 'torus';
  params: {
    radius?: number;        // major (ring) radius
    tube?: number;          // minor (tube) radius
    radialSegments?: number;
    tubularSegments?: number;
  };
}

export interface TubeGeometry {
  type: 'tube';
  params: {
    radius?: number;        // outer radius
    thickness?: number;     // wall thickness
    height?: number;
    radialSegments?: number;
    /** Bevel radius applied to the top and bottom edges of the annular profile. */
    bevel?: number;
    bevelSegments?: number;
  };
}

export interface ParaboloidGeometry {
  type: 'paraboloid';
  params: {
    radius?: number;
    height?: number;
    radialSegments?: number;
  };
}

export interface IcosahedronGeometry {
  type: 'icosahedron';
  params: {
    radius?: number;
  };
}

/**
 * TinkerCad's `star` shape: not a flat extrusion. The arms are pyramidal —
 * each outline edge meets a single apex on the central axis at the top,
 * producing ridges radiating from the center along each arm. See
 * `extrudeStar` for the flat variant.
 */
export interface StarGeometry {
  type: 'star';
  params: {
    sides?: number;
    radius?: number;       // outer (vertex) radius
    innerRadius?: number;  // fraction (0..1) of outer radius
    height?: number;
  };
}

export interface ExtrudeStarGeometry {
  type: 'extrudeStar';
  params: {
    sides?: number;
    radius?: number;
    innerRadius?: number;
    height?: number;
  };
}

export interface HeartGeometry {
  type: 'heart';
  params: {
    radius?: number;
    height?: number;
  };
}

/**
 * `ring` is the TinkerCad ring/torus generator: a 2D cross-section (`pattern`)
 * is offset by `radius` along the radial axis and revolved around the central
 * Y axis. `pattern` is pre-discretized into a polygon at import time so this
 * type is closed; SceneDataParser handles the bezier→polygon conversion.
 */
export interface RingGeometry {
  type: 'ring';
  /** Discretized cross-section polygon. Imported at parse time and treated
   *  as immutable data, not an editable param. */
  pattern: [number, number][];
  params: {
    radius?: number;
    segments?: number;
  };
}

/**
 * Square bipyramid (two square pyramids joined at their bases). Used as the
 * placeholder shape for TinkerCad's legacy "Diamond" preset (id 405).
 */
export interface DiamondGeometry {
  type: 'diamond';
  params: {
    /** Half the base-diagonal width. */
    radius?: number;
    /** Total tip-to-tip height. */
    height?: number;
  };
}

export interface PolygonGeometry {
  type: 'polygon';
  params: {
    radius?: number;
    height?: number;
    sides?: number;
    /**
     * Bevel radius applied to every edge of the prism (top/bottom caps and
     * the vertical edges between adjacent side faces). When > 0 the prism is
     * built as the convex hull of spheres at each inset vertex, matching the
     * approach used by box bevels.
     */
    bevel?: number;
    bevelSegments?: number;
  };
}

export interface PyramidGeometry {
  type: 'pyramid';
  params: {
    radius?: number;
    height?: number;
    sides?: number;
  };
}

export interface WedgeGeometry {
  type: 'wedge';
  params: {
    width?: number;
    height?: number;
    depth?: number;
  };
}

export interface RoofGeometry {
  type: 'roof';
  params: {
    width?: number;
    height?: number;
    depth?: number;
  };
}

/**
 * A BAKED static mesh stored INLINE on the node — the result of "baking" a
 * node's transform and/or modifier stack into fixed geometry (see
 * `useBakeNode` / `bakeMesh.ts`). Unlike `imported` (which references asset
 * bytes in storage), a baked mesh is self-contained: its triangulated geometry
 * travels with the scene JSON as little-endian base64 typed-array dumps, the
 * same way an embedded sub-tree carries its own data. The geometry is already in
 * the Three.js render frame (Y-up) — the `mesh` shape returns it verbatim, with
 * no CAD→Three rotation, exactly like an imported mesh — and participates in CSG
 * via `geometryToManifold` like any other primitive.
 *
 * `id` is a cheap CONTENT key (a hash of the vertex data, stamped at bake time)
 * used as the factory/cache/hash key so neither `cacheKey` nor `nodeHasher`
 * has to stringify the (potentially large) inline blob on every rebuild —
 * keyed by a cheap content id rather than the inline blob.
 */
export interface MeshGeometry {
  type: 'mesh';
  /** Cheap content key (hash of the vertex data). Cache + node-hash key. */
  id: string;
  /** Display name (tree/palette label). Not used for lookup. */
  name?: string;
  data: {
    /** Vertex count (positions / normals / colours all share this count). */
    vertexCount: number;
    /** base64 little-endian `Float32Array`, xyz triples (stride 3). */
    position: string;
    /** base64 little-endian `Float32Array`, xyz normals (stride 3). */
    normal: string;
    /** base64 little-endian `Float32Array`, rgb triples (stride 3). Present
     *  only when the source carried real per-vertex colour (imported /
     *  multicolor); absent for plain-material nodes (colour comes from
     *  `material` instead, so vertex-colours stay off and can't render black). */
    color?: string;
    /** Triangle index count. Absent ⇒ the mesh is non-indexed. */
    indexCount?: number;
    /** base64 little-endian `Uint32Array` triangle indices. */
    index?: string;
  };
  /** Reserved — keeps the geometry shape uniform for the property panel. */
  params?: Record<string, never>;
}

/** Every built-in geometry the shared shapes registry builds. */
export type BuiltinGeometry =
  | BoxGeometry
  | CylinderGeometry
  | FilletGeometry
  | CapsuleGeometry
  | ConeGeometry
  | SphereGeometry
  | HalfSphereGeometry
  | HalfCylinderGeometry
  | TorusGeometry
  | TubeGeometry
  | ParaboloidGeometry
  | IcosahedronGeometry
  | PolygonGeometry
  | PyramidGeometry
  | WedgeGeometry
  | RoofGeometry
  | StarGeometry
  | ExtrudeStarGeometry
  | HeartGeometry
  | RingGeometry
  | DiamondGeometry
  | MeshGeometry;
