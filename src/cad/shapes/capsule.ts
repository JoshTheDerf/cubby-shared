import type { CapsuleGeometry } from '../geometry';
import { defineShape } from './registry';
import { arcPoints, revolveProfile, type Point2D } from './_helpers';
import { sdRoundCone } from '../sdf/primitives';

/** Smallest permissible end radius (mm) — keeps the lathe profile and the
 *  tangent geometry well-conditioned when a scale collapses to ~0. */
const MIN_RADIUS = 0.1;

/**
 * Lathe profile of a sphere-swept cone ("round cone") for revolution.
 *
 * In the revolve plane `[radius, axial]` (CAD Z-up — revolveProfile spins
 * around the axial axis): bottom sphere of radius `r1` centred at
 * axial = `r1`, top sphere of radius `r2` centred at axial = `r1 + h`.
 * The lowest point is the bottom sphere's south pole at axial = 0.
 *
 * The profile walks the OUTER silhouette: south pole → bottom arc up to
 * the external-tangent point → straight tangent segment → top arc up to
 * the north pole, then straight back down the axis (radius 0) to close.
 *
 * Tangent geometry: with `d = h` the centre spacing and
 * `b = (r1 − r2) / d`, the common external tangent touches each sphere
 * where the outward normal is the tangent-cone normal `(a, b)` with
 * `a = sqrt(1 − b²)`. In `arcPoints`' angle convention (`t` measured
 * from +radius, so a point is `(r·cos t, cy + r·sin t)`), that tangent
 * point sits at `t = asin(b)` on BOTH spheres. For `r1 > r2` (`b > 0`)
 * the tangent is above the equator, so the bottom arc runs from the
 * south pole through the equator (radial = r1) up to it — the widest
 * cross-section radial = max(r1, r2) is therefore always on the
 * silhouette. When one sphere swallows the other (|r1 − r2| ≥ d), there
 * is no external tangent and we degenerate to a single arc of the larger
 * sphere so the profile never produces NaNs.
 */
function roundConeProfile(
  r1: number, r2: number, h: number, segments: number,
): Point2D[] {
  const y1 = r1;           // bottom sphere centre (axial)
  const y2 = r1 + h;       // top sphere centre (axial)
  const arcSegs = Math.max(2, Math.round(segments / 4));

  // Degenerate: no external tangent — render the larger enclosing sphere
  // as a full half-arc (revolved into a sphere). Centre at the larger
  // sphere's centre; the smaller sphere is fully inside it.
  if (!(h > 1e-9) || Math.abs(r1 - r2) >= h) {
    const big = r1 >= r2 ? { r: r1, cy: y1 } : { r: r2, cy: y2 };
    const pts: Point2D[] = [[0, big.cy - big.r]];
    // South pole (−π/2) up to north pole (+π/2) along +radius side.
    pts.push(...arcPoints(0, big.cy, big.r, -Math.PI / 2, Math.PI / 2, segments));
    return pts;
  }

  const b = (r1 - r2) / h;
  // Tangent-point angle in arcPoints' convention (measured from +radius
  // axis). The tangent point's outward normal is (a, b) with a=√(1−b²),
  // so the point on a sphere of radius r is r·(a, b) ⇒ radial = r·a,
  // axial offset = r·b ⇒ t = atan2(b, a) = asin(b).
  const tTangent = Math.asin(Math.max(-1, Math.min(1, b)));

  const pts: Point2D[] = [];
  // 1) Bottom arc: south pole (t = −π/2) up to the tangent point.
  pts.push([0, y1 - r1]); // south pole
  pts.push(...arcPoints(0, y1, r1, -Math.PI / 2, tTangent, arcSegs));
  // 2) Tangent segment up to the top sphere's tangent point (same t),
  //    then the top arc up to the north pole (t = π/2).
  pts.push(...arcPoints(0, y2, r2, tTangent, Math.PI / 2, arcSegs));
  // 3) North pole is the final arc point (t = π/2); close down the axis.
  pts.push([0, y2 + r2]);
  return pts;
}

export const capsuleShape = defineShape<CapsuleGeometry>({
  id: 'capsule',
  label: 'Capsule', labelKey: 'primitives.capsule',
  icon: 'i-lucide-pill',
  palette: true,
  defaults: { radius: 10, height: 20, topScale: 1, bottomScale: 1, segments: 32 },
  schema: {
    properties: {
      radius:      { type: 'number',  label: 'Radius', labelKey: 'params.radius',       unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      height:      { type: 'number',  label: 'Centre gap', labelKey: 'params.centreGap',   unit: 'mm', default: 20, min: 0,   step: 1, sliderMax: 100 },
      topScale:    { type: 'number',  label: 'Top scale', labelKey: 'params.topScale',                default: 1,  min: 0.05, max: 4, step: 0.05 },
      bottomScale: { type: 'number',  label: 'Bottom scale', labelKey: 'params.bottomScale',             default: 1,  min: 0.05, max: 4, step: 0.05 },
      segments:    { type: 'integer', label: 'Segments', labelKey: 'params.segments',                 default: 32, min: 3,   max: 256, step: 1 },
    },
    order: ['radius', 'height', 'topScale', 'bottomScale', 'segments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const radius = p.radius ?? 10;
    const h = Math.max(0, p.height ?? 20);
    const segs = p.segments || 32;
    const r1 = Math.max(MIN_RADIUS, radius * (p.bottomScale ?? 1));
    const r2 = Math.max(MIN_RADIUS, radius * (p.topScale ?? 1));
    return { manifold: revolveProfile(wasm, roundConeProfile(r1, r2, h, segs), segs) };
  },
  // Mesh sits bottom-snapped: lowest point at axial = 0, bottom sphere
  // centre at axial = rBottom, top centre at axial = rBottom + h. After
  // the CAD→Three rotation the axial axis becomes +Y.
  sdf(geom) {
    // Three frame (Y-up): bottom sphere centre at y = rBottom, top sphere
    // centre at y = rBottom + h. `sdRoundCone` measures from the bottom
    // centre, so shift the sample point by rBottom (i.e. centre at
    // y = rBottom). `h` is the distance between the two centres.
    const radius = geom.params.radius ?? 10;
    const h = Math.max(0, geom.params.height ?? 20);
    const r1 = Math.max(MIN_RADIUS, radius * (geom.params.bottomScale ?? 1));
    const r2 = Math.max(MIN_RADIUS, radius * (geom.params.topScale ?? 1));
    const c = { x: 0, y: r1, z: 0 };
    const rMax = Math.max(r1, r2);
    // Exact union of both spheres' axial extents (not r1+h+r2, which CLIPS the
    // degenerate cases): bottom sphere centre y=r1 radius r1 → [0, 2·r1]; top
    // sphere centre y=r1+h radius r2 → [r1+h−r2, r1+h+r2]. When one sphere
    // swallows the other (|r1−r2| ≥ h) the larger sphere's extent dominates —
    // e.g. r1≫h+r2 reaches y=2·r1 > r1+h+r2, and r2-dominant dips below y=0.
    const yMin = Math.min(0, r1 + h - r2);
    const yMax = Math.max(2 * r1, r1 + h + r2);
    return {
      sample: (x, y, z) => sdRoundCone({ x, y, z }, c, r1, r2, h),
      bounds: { min: { x: -rMax, y: yMin, z: -rMax }, max: { x: rMax, y: yMax, z: rMax } },
    };
  },
});
