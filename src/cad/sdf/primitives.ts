/**
 * Neutral analytic SDF primitives. Each function returns the signed
 * distance from `p` to the primitive's surface — negative inside,
 * positive outside, voxel/sample units. Formulas follow Inigo Quilez's
 * canonical SDF page; sphere / box / capsule / cylinder / ellipsoid /
 * tetrahedron are exact, cone is a piecewise approximation that's
 * correct on the surface and conservative outside (good enough for
 * surface-nets sampling).
 *
 * These primitives are deliberately decoupled from any scene-graph
 * stroke or geometry-node type — callers pass plain shape parameters
 * (center, radius, half-extents, etc.) so the same code serves the
 * voxel workbench's analytic eval path and the main workbench's
 * per-group SDF CSG mode without a back-import dependency.
 */

import type { Vec3 } from './types';

export function sdSphere(p: Vec3, center: Vec3, radius: number): number {
  const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
  return Math.hypot(dx, dy, dz) - radius;
}

export function sdBox(p: Vec3, center: Vec3, half: Vec3): number {
  const qx = Math.abs(p.x - center.x) - half.x;
  const qy = Math.abs(p.y - center.y) - half.y;
  const qz = Math.abs(p.z - center.z) - half.z;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside;
}

/** Y-up capsule. `halfLength` is the cylindrical-segment half-length
 *  excluding the hemispherical caps; total height = 2*(halfLength + radius). */
export function sdCapsule(
  p: Vec3, center: Vec3, radius: number, halfLength: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const cy = Math.max(-halfLength, Math.min(halfLength, dy));
  const ey = dy - cy;
  return Math.hypot(dx, ey, dz) - radius;
}

/**
 * Y-up sphere-swept cone (IQ `sdRoundCone`). The bottom sphere of
 * radius `r1` sits at `center`; the top sphere of radius `r2` sits at
 * `center + (0, h, 0)` where `h` is the distance between the two
 * centres. Exact signed distance.
 *
 * With `b = (r1 − r2) / h` and `a = sqrt(1 − b·b)` (the tangent-cone
 * geometry), in the (radial, axial) half-plane `q = (length(p.xz), p.y)`:
 *   - `k < 0`            → nearest feature is the bottom sphere.
 *   - `k > a·h`          → nearest feature is the top sphere.
 *   - otherwise          → nearest feature is the tangent cone surface.
 *
 * Degenerate cases (h ≈ 0, or one sphere swallowing the other so
 * |r1 − r2| ≥ h ⇒ |b| ≥ 1) fall back to the larger sphere's SDF — no
 * NaNs from the `sqrt(1 − b·b)`.
 */
export function sdRoundCone(
  p: Vec3, center: Vec3, r1: number, r2: number, h: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  // Degenerate: zero (or near-zero) centre spacing, or one sphere
  // entirely contains the other ⇒ the union is just the bigger sphere.
  if (!(h > 1e-9) || Math.abs(r1 - r2) >= h) {
    if (r1 >= r2) {
      return Math.hypot(dx, dy, dz) - r1;
    }
    const tdy = dy - h;
    return Math.hypot(dx, tdy, dz) - r2;
  }
  const b = (r1 - r2) / h;
  const a = Math.sqrt(1 - b * b);
  const qx = Math.hypot(dx, dz);
  const qy = dy;
  const k = qx * -b + qy * a;
  if (k < 0) return Math.hypot(qx, qy) - r1;
  if (k > a * h) return Math.hypot(qx, qy - h) - r2;
  return qx * a + qy * b - r1;
}

/** Y-up finite cylinder centred on `center`. */
export function sdCylinder(
  p: Vec3, center: Vec3, radius: number, halfHeight: number,
): number {
  const dx = p.x - center.x;
  const dz = p.z - center.z;
  const dy = p.y - center.y;
  const d2 = Math.hypot(dx, dz) - radius;
  const dyAbs = Math.abs(dy) - halfHeight;
  const outside = Math.hypot(Math.max(d2, 0), Math.max(dyAbs, 0));
  const inside = Math.min(Math.max(d2, dyAbs), 0);
  return outside + inside;
}

/** Y-up finite cone, apex on top, base on the bottom. `center` is the
 *  midpoint of the bounding height. */
export function sdCone(
  p: Vec3, center: Vec3, radius: number, halfHeight: number,
): number {
  const dx = p.x - center.x, dz = p.z - center.z;
  const r = Math.hypot(dx, dz);
  const axial = p.y - (center.y - halfHeight);
  const totalH = 2 * halfHeight;
  const nx = totalH, ny = radius;
  const nLen = Math.hypot(nx, ny);
  const slantD = (nx * r + ny * axial - nx * radius) / nLen;
  const baseD = -axial;
  const apexD = axial - totalH;
  const outsideX = Math.max(slantD, 0);
  const outsideY = Math.max(Math.max(baseD, apexD), 0);
  const outside = Math.hypot(outsideX, outsideY);
  const inside = Math.min(Math.max(slantD, Math.max(baseD, apexD)), 0);
  return outside + inside;
}

export function sdEllipsoid(p: Vec3, center: Vec3, radii: Vec3): number {
  // Inigo Quilez's "bound" formulation — not the true distance, but a
  // sign-correct estimate well-behaved for SN sampling.
  const rx = Math.max(radii.x, 1e-6);
  const ry = Math.max(radii.y, 1e-6);
  const rz = Math.max(radii.z, 1e-6);
  const dx = (p.x - center.x) / rx;
  const dy = (p.y - center.y) / ry;
  const dz = (p.z - center.z) / rz;
  const k0 = Math.hypot(dx, dy, dz);
  const k1 = Math.hypot(dx / rx, dy / ry, dz / rz);
  if (k1 === 0) return -Math.min(rx, ry, rz);
  return k0 * (k0 - 1) / k1;
}

/** Y-up frustum (truncated cone). `radiusBottom` at the bottom cap
 *  (y = center.y − halfHeight), `radiusTop` at the top cap
 *  (y = center.y + halfHeight). Reduces to a pure cone when one cap is
 *  zero. IQ's `sdCappedCone` formulation, swung onto the Y axis. */
export function sdCappedCone(
  p: Vec3, center: Vec3,
  radiusBottom: number, radiusTop: number, halfHeight: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const r = Math.hypot(dx, dz);
  const rb = radiusBottom, rt = radiusTop, h = halfHeight;
  const qx = r, qy = dy;
  const k2x = rt - rb, k2y = 2 * h;
  const k2Len2 = k2x * k2x + k2y * k2y;
  const cax = qx - Math.min(qx, qy < 0 ? rb : rt);
  const cay = Math.abs(qy) - h;
  const dotK1 = (rt - qx) * k2x + (h - qy) * k2y;
  const tProj = k2Len2 > 0 ? Math.max(0, Math.min(1, dotK1 / k2Len2)) : 0;
  const cbx = qx - rt + k2x * tProj;
  const cby = qy - h + k2y * tProj;
  const inside = cbx < 0 && cay < 0;
  const s = inside ? -1 : 1;
  const d = Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
  return s * d;
}

/** Y-major torus (ring around the Y axis). `majorR` is the centerline
 *  radius, `minorR` is the tube radius. */
export function sdTorus(
  p: Vec3, center: Vec3, majorR: number, minorR: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const radial = Math.hypot(dx, dz) - majorR;
  return Math.hypot(radial, dy) - minorR;
}

// -----------------------------------------------------------------------
// Z-up variants. Used by the per-group SDF CSG mode (which operates in
// the shape registry's CAD frame, where +Z is up). Y-up variants above
// continue to serve the voxel workbench's analytic eval path (where
// +Y is up to match Three.js world space).
// -----------------------------------------------------------------------

export function sdCylinderZ(
  p: Vec3, center: Vec3, radius: number, halfHeight: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const d2 = Math.hypot(dx, dy) - radius;
  const dzAbs = Math.abs(dz) - halfHeight;
  const outside = Math.hypot(Math.max(d2, 0), Math.max(dzAbs, 0));
  const inside = Math.min(Math.max(d2, dzAbs), 0);
  return outside + inside;
}

/** Z-up frustum (truncated cone). `radiusBottom` is the radius at the
 *  bottom cap (z = center.z − halfHeight), `radiusTop` at the top cap
 *  (z = center.z + halfHeight). Reduces to a pure cone when one cap is
 *  zero. Follows Inigo Quilez's `sdCappedCone` formulation. */
export function sdCappedConeZ(
  p: Vec3, center: Vec3,
  radiusBottom: number, radiusTop: number, halfHeight: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const r = Math.hypot(dx, dy);
  // 2D capped-cone SDF in (radial, axial) space, with the cone going
  // from (rb, -h) at the bottom to (rt, +h) at the top.
  const rb = radiusBottom, rt = radiusTop, h = halfHeight;
  const qx = r;
  const qy = dz;
  // Lateral slant from (rb,-h) to (rt,+h); we project onto the segment
  // k2 = (rt - rb, 2h).
  const k2x = rt - rb, k2y = 2 * h;
  const k2Len2 = k2x * k2x + k2y * k2y;
  const cax = qx - Math.min(qx, qy < 0 ? rb : rt);
  const cay = Math.abs(qy) - h;
  // Project (qx - rt, qy - h) onto k2.
  const dotK1 = (rt - qx) * k2x + (h - qy) * k2y;
  const tProj = k2Len2 > 0 ? Math.max(0, Math.min(1, dotK1 / k2Len2)) : 0;
  const cbx = qx - rt + k2x * tProj;
  const cby = qy - h + k2y * tProj;
  const inside = cbx < 0 && cay < 0;
  const s = inside ? -1 : 1;
  const d = Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
  return s * d;
}

/** Z-major torus (ring around the Z axis). */
export function sdTorusZ(
  p: Vec3, center: Vec3, majorR: number, minorR: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const radial = Math.hypot(dx, dy) - majorR;
  return Math.hypot(radial, dz) - minorR;
}

/** Regular tetrahedron with circumradius `size`. Vertices sit at the
 *  standard ±/± diagonals of the unit cube scaled by size / sqrt(3). */
export function sdTetrahedron(p: Vec3, center: Vec3, size: number): number {
  const k = size / Math.sqrt(3);
  const verts: Vec3[] = [
    { x:  k, y:  k, z:  k },
    { x:  k, y: -k, z: -k },
    { x: -k, y:  k, z: -k },
    { x: -k, y: -k, z:  k },
  ];
  const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
  let m = -Infinity;
  for (let i = 0; i < 4; i++) {
    const v = verts[i];
    const len = Math.hypot(v.x, v.y, v.z);
    const nx = v.x / len, ny = v.y / len, nz = v.z / len;
    const ref = verts[(i + 1) % 4];
    const offset = ref.x * nx + ref.y * ny + ref.z * nz;
    const d = dx * nx + dy * ny + dz * nz - offset;
    if (d > m) m = d;
  }
  return m;
}

// =============================================================================
// Compositions + closed-form SDFs for the second wave of shape-registry
// primitives. These deliberately mirror the mesh build's Three-frame bounds
// (bottom-snapped at y = 0, CSG-layer Y-up) so the analytic SDF and the
// rendered mesh agree on the same surface.
// =============================================================================

/** Y-up tube (cylinder with axial hole). Base at y = 0, top at y = h,
 *  outer radius `rOuter`, inner radius `rInner`. SDF = the outer
 *  cylinder carved by the inner cylinder; both share the same axis. */
export function sdTube(
  p: Vec3, center: Vec3, rOuter: number, rInner: number, halfHeight: number,
): number {
  const outer = sdCylinder(p, center, rOuter, halfHeight);
  const inner = sdCylinder(p, center, rInner, halfHeight);
  // max(outer, -inner) = "outer AND NOT inner".
  return outer > -inner ? outer : -inner;
}

/** Three-frame concave corner fillet (cove), facing UP. A square prism
 *  occupying x ∈ [0, r], y ∈ [0, r], z ∈ [0, h] has a quarter-cylinder of
 *  radius `r` (axis along +Z, the horizontal run, centred at x = y = r)
 *  carved out of it, leaving a rounded interior slope. The piece rests on
 *  its flat bottom (y = 0) and flat back (x = 0); the cove opens upward
 *  toward (+x, +y). = box ∩ ¬cylinder, so max(box, −cylinder). The carving
 *  cylinder shares the prism's length. */
export function sdFillet(p: Vec3, r: number, h: number): number {
  const boxD = sdBox(
    p,
    { x: r / 2, y: r / 2, z: h / 2 },
    { x: r / 2, y: r / 2, z: h / 2 },
  );
  const cylD = sdCylinderZ(p, { x: r, y: r, z: h / 2 }, r, h / 2);
  // max(box, −cylinder) = "inside the prism AND outside the cylinder".
  return boxD > -cylD ? boxD : -cylD;
}

/** Bottom-snapped hemisphere — flat base at y = center.y, dome rising
 *  to y = center.y + r. Equivalent to a full sphere clipped by the
 *  half-space `y >= center.y`. Exact distance. */
export function sdHalfSphere(p: Vec3, center: Vec3, radius: number): number {
  const sphereD = sdSphere(p, center, radius);
  const planeD = center.y - p.y; // half-space y >= center.y
  return sphereD > planeD ? sphereD : planeD;
}

/** Half-ellipse prism (mesh halfCylinder). 2D half-ellipse cross-
 *  section in the XY plane (x ∈ [-rx, rx], y ∈ [center.y, center.y+ry])
 *  extruded along Z with half-depth `halfDepth`.
 *
 *  Uses IQ's "bound" ellipse approximation in 2D (k0*(k0-1)/k1) so the
 *  distance is sign-correct and well-behaved near the surface but not
 *  exactly Euclidean far from it. Good enough for surface extraction
 *  and smooth-blend; matches what `sdEllipsoid` does for the 3D case. */
export function sdHalfCylinderEll(
  p: Vec3, center: Vec3, rx: number, ry: number, halfDepth: number,
): number {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const rxe = Math.max(rx, 1e-6);
  const rye = Math.max(ry, 1e-6);
  const ex = dx / rxe, ey = dy / rye;
  const k0 = Math.hypot(ex, ey);
  const k1 = Math.hypot(ex / rxe, ey / rye);
  const ellipseD = k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(rxe, rye);
  const planeD = -dy;
  const halfEllipseD = ellipseD > planeD ? ellipseD : planeD;
  const slabD = Math.abs(dz) - halfDepth;
  return halfEllipseD > slabD ? halfEllipseD : slabD;
}

/** Wedge in Three frame: right-triangular prism whose cross-section
 *  in the YZ plane has vertices (y=0, z=-d/2), (y=0, z=+d/2),
 *  (y=h, z=+d/2). Extruded along X from x=0 to x=w. The slant runs
 *  from the back-bottom edge up to the front-top edge.
 *
 *  Built from three half-spaces plus a slab along X — exact distance. */
export function sdWedge(p: Vec3, w: number, h: number, d: number): number {
  const halfD = d / 2;
  const slopeNumer = d * p.y - h * p.z - d * h * 0.5;
  const slopeLen = Math.hypot(d, h);
  const slopeD = slopeLen > 0 ? slopeNumer / slopeLen : slopeNumer;
  const bottomD = -p.y;
  const frontD = p.z - halfD;
  const triD = Math.max(slopeD, Math.max(bottomD, frontD));
  const slabX = Math.abs(p.x - w * 0.5) - w * 0.5;
  return triD > slabX ? triD : slabX;
}

/** Roof in Three frame: isoceles triangular prism with the base of
 *  width `w` along X at y = 0, apex at (0, h, *). Extruded along Z
 *  from z = 0 to z = d. */
export function sdRoof(p: Vec3, w: number, h: number, d: number): number {
  const slantNumer = h * Math.abs(p.x) + (w * 0.5) * p.y - h * w * 0.5;
  const slantLen = Math.hypot(h, w * 0.5);
  const slantD = slantLen > 0 ? slantNumer / slantLen : slantNumer;
  const bottomD = -p.y;
  const triD = slantD > bottomD ? slantD : bottomD;
  const slabZ = Math.abs(p.z - d * 0.5) - d * 0.5;
  return triD > slabZ ? triD : slabZ;
}

/** Solid paraboloid of revolution. Profile `y = h * (1 − (r/R)²)`,
 *  flat base at y = 0, apex at y = h. Uses IQ's ellipsoid-bound trick
 *  in (radial, height) space — sign-correct, exact at the surface,
 *  biased farther out. */
export function sdParaboloid(
  p: Vec3, center: Vec3, radius: number, height: number,
): number {
  if (height <= 0 || radius <= 0) return Infinity;
  const dx = p.x - center.x;
  const dz = p.z - center.z;
  const radial = Math.hypot(dx, dz);
  const dy = p.y - center.y;
  const f = (radial * radial) / (radius * radius) + dy / height - 1;
  const len = Math.min(radius, height);
  const shellD = f * len;
  const baseD = -dy;
  return shellD > baseD ? shellD : baseD;
}

/** Regular N-gon prism in Three frame. Cross-section in XZ plane,
 *  inscribed-circumradius `radius`, vertex 0 at (0, 0, +radius)
 *  (matches polygonProfile's `angle = 2πi/N − π/2` after CAD→Three).
 *  Extruded vertically y ∈ [0, h]. Closed-form IQ regular-polygon
 *  SDF in 2D plus a Y slab — exact. */
export function sdPolygonPrism(
  p: Vec3, radius: number, sides: number, height: number,
): number {
  const px = p.x, pz = p.z;
  const an = Math.PI / sides;
  // The IQ formula assumes a vertex along +X; rotate (x, z) so +Z
  // maps to +X' via (x', z') = (z, -x).
  const x2 = pz, z2 = -px;
  let a = Math.atan2(z2, x2);
  // Fold so the vertex (a=0) maps to folded angle ±an, and the face
  // midpoints (a=±an) map to 0. JS `%` returns negative for negative
  // dividends, so the double `+ 2*an` then mod is the standard
  // non-negative-remainder fix-up.
  a = ((a % (2 * an)) + 2 * an) % (2 * an) - an;
  const r0 = Math.hypot(x2, z2);
  const d2 = Math.cos(a) * r0 - radius * Math.cos(an);
  const slabY = Math.abs(p.y - height * 0.5) - height * 0.5;
  return d2 > slabY ? d2 : slabY;
}

/** N-pointed star prism in Three frame. Cross-section in XZ plane;
 *  `radius` = outer radius, `innerRatio` ∈ (0,1] = inner/outer, `n` =
 *  number of points. Extruded y ∈ [0, h]. Uses IQ's analytic 2D star
 *  SDF (sign-correct, exact at points). */
export function sdStarPrism(
  p: Vec3, radius: number, innerRatio: number, sides: number, height: number,
): number {
  // Match `extrudeStar`'s startAngle = π/2 − π/10 by rotating the
  // sampled (x, z) so the first outer vertex lands at the canonical
  // (0, r) used below.
  const startAngle = Math.PI / 2 - Math.PI / 10;
  const ca = Math.cos(-startAngle), sa = Math.sin(-startAngle);
  // CAD→Three swap: polygon was built in CAD XY (CAD-x → Three-X,
  // CAD-y → -Three-Z), so we use (Three-X, -Three-Z) as the 2D coords.
  const ux = p.x, uy = -p.z;
  const sx = ca * ux - sa * uy;
  const sy = sa * ux + ca * uy;
  const n = sides;
  const m = Math.max(0.001, Math.min(1, innerRatio));
  const an = Math.PI / n;
  const en = Math.PI / Math.max(2, n * m);
  const acsX = Math.cos(an), acsY = Math.sin(an);
  const ecsX = Math.cos(en), ecsY = Math.sin(en);
  const bn = ((Math.atan2(sx, sy) % (2 * an)) + 2 * an) % (2 * an) - an;
  const r0 = Math.hypot(sx, sy);
  let qx = r0 * Math.cos(bn);
  let qy = r0 * Math.abs(Math.sin(bn));
  qx -= radius * acsX;
  qy -= radius * acsY;
  const dotPE = qx * ecsX + qy * ecsY;
  const maxT = ecsY > 0 ? radius * acsY / ecsY : 0;
  const t = Math.max(0, Math.min(maxT, -dotPE));
  qx += ecsX * t;
  qy += ecsY * t;
  const d2 = Math.hypot(qx, qy) * (qx < 0 ? -1 : 1);
  const slabY = Math.abs(p.y - height * 0.5) - height * 0.5;
  return d2 > slabY ? d2 : slabY;
}
