import type { ManifoldWasm } from '../wasm';

export type Point2D = [number, number];

/** Points along a circular arc, inclusive of both endpoints. */
export function arcPoints(
  cx: number, cy: number,
  radius: number,
  startAngle: number, endAngle: number,
  segments: number,
): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / segments);
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

/** Regular polygon inscribed in a circle of the given radius. */
export function polygonProfile(radius: number, sides: number): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

/** Rectangle profile. Centered around the origin or anchored at (0,0). */
export function rectProfile(width: number, depth: number, centered = true): Point2D[] {
  const hw = width / 2, hd = depth / 2;
  if (centered) {
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  }
  return [[0, 0], [width, 0], [width, depth], [0, depth]];
}

/** Cylinder profile for revolution (rectangle, optionally with top/bottom bevels). */
export function cylinderProfile(
  radius: number, height: number, bevel: number, bevelSegs: number,
): Point2D[] {
  const r = Math.min(bevel, radius, height / 2);
  if (r <= 0 || bevelSegs <= 0) {
    return [[0, 0], [radius, 0], [radius, height], [0, height]];
  }
  const points: Point2D[] = [];
  points.push(...arcPoints(radius - r, r, r, -Math.PI / 2, 0, bevelSegs));
  points.push([radius, r], [radius, height - r]);
  points.push(...arcPoints(radius - r, height - r, r, 0, Math.PI / 2, bevelSegs));
  points.push([0, height], [0, 0]);
  return points;
}

/** Frustum profile for revolution. Collapses to a triangle when `radiusTop = 0`. */
export function coneProfile(radiusBottom: number, radiusTop: number, height: number): Point2D[] {
  if (radiusTop <= 0) {
    return [[0, 0], [radiusBottom, 0], [0, height]];
  }
  return [[0, 0], [radiusBottom, 0], [radiusTop, height], [0, height]];
}

/** Hemisphere profile for revolution. */
export function hemisphereProfile(radius: number, segments: number): Point2D[] {
  const points: Point2D[] = [[0, 0]];
  points.push(...arcPoints(0, 0, radius, 0, Math.PI / 2, segments));
  return points;
}

/** Extrude a 2D profile along Z. */
export function extrudeProfile(wasm: ManifoldWasm, profile: Point2D[], height: number): any {
  const cs = new wasm.CrossSection([profile]);
  return cs.extrude(height);
}

/** Revolve a 2D profile around Z. */
export function revolveProfile(
  wasm: ManifoldWasm, profile: Point2D[], segments: number, degrees = 360,
): any {
  const cs = new wasm.CrossSection([profile]);
  if (degrees >= 360) return wasm.Manifold.revolve(cs, segments);
  return wasm.Manifold.revolve(cs, segments, degrees);
}

/** Signed polygon area (shoelace). Positive ⇒ CCW, negative ⇒ CW. */
export function signedArea(ring: Point2D[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return s / 2;
}

/**
 * Allocate a numProp=6 `vertProperties` buffer for a Manifold mesh
 * builder: positions interleaved with default-white (1, 1, 1) colours.
 * Every shape builder in this directory targets the same convention
 * (see CSGProcessor's `geometryToManifold` — numProp=6 keeps every
 * primitive interoperable with colour-carrying voxel meshes under CSG).
 * Centralising the packer keeps the three direct-Mesh builders
 * (icosahedron, star, diamond) from drifting in lockstep.
 */
export function buildVertPropsWhite(positions: number[][]): Float32Array {
  const out = new Float32Array(positions.length * 6);
  for (let i = 0; i < positions.length; i++) {
    const o = i * 6;
    out[o]     = positions[i][0];
    out[o + 1] = positions[i][1];
    out[o + 2] = positions[i][2];
    out[o + 3] = 1;
    out[o + 4] = 1;
    out[o + 5] = 1;
  }
  return out;
}
