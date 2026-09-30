import type { FilletGeometry } from '../geometry';
import { defineShape } from './registry';
import { cylinderProfile, revolveProfile } from './_helpers';
import { sdFillet } from '../sdf/primitives';

/**
 * Concave corner fillet (cove) — literally a cylinder subtracted from a
 * cube, leaving a rounded interior slope. Shares the cylinder's parameter
 * set: `radius` sizes both the carving cylinder and the square cross-section
 * (side = radius); `height` is the run length; `radialSegments` tessellates
 * the arc; `bevel`/`bevelSegments` round the rim of the carving cylinder.
 *
 * Oriented to face UP: it rests on a flat bottom (y = 0) and flat back
 * (x = 0), the run goes horizontally, and the rounded slope opens upward.
 */
export const filletShape = defineShape<FilletGeometry>({
  id: 'fillet',
  label: 'Fillet', labelKey: 'primitives.fillet',
  icon: 'i-lucide-spline',
  palette: true,
  defaults: { radius: 10, height: 20, radialSegments: 32, bevel: 0, bevelSegments: 1 },
  schema: {
    properties: {
      radius:         { type: 'number',  label: 'Radius', labelKey: 'params.radius',   unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      height:         { type: 'number',  label: 'Height', labelKey: 'params.height',   unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      radialSegments: { type: 'integer', label: 'Segments', labelKey: 'params.segments',             default: 32, min: 3, max: 256, step: 1 },
      bevel:          { type: 'number',  label: 'Bevel', labelKey: 'params.bevel',    unit: 'mm', default: 0,  min: 0, step: 0.5, sliderMax: 10 },
      bevelSegments:  { type: 'integer', label: 'Bevel segments', labelKey: 'params.bevelSegments',       default: 1,  min: 1, max: 32, step: 1 },
    },
    order: ['radius', 'height', 'radialSegments', 'bevel', 'bevelSegments'],
  },
  build(geom, { wasm }) {
    const { Manifold } = wasm;
    const p = geom.params;
    const r = p.radius ?? 10;
    const h = p.height || 20;
    const segs = p.radialSegments || 32;
    const bevel = p.bevel ?? 0;
    const bevelSegs = p.bevelSegments ?? 1;
    // Build the cove directly in the target (Three) frame, then a single
    // +90° rotation about X pre-compensates the factory's −90° CAD→Three
    // rotation so the net result IS the target. This keeps the mesh in the
    // exact frame the analytic SDF (`sdFillet`) describes.
    //
    // Square prism: x,y ∈ [0, r], z ∈ [0, h]. Carving cylinder, built like
    // the Cylinder primitive (so all its params, incl. bevel, round the cove
    // rim): revolve spins the profile around Y and re-maps the axis to +Z,
    // base z = 0, top z = h — exactly the horizontal run we want. Translated
    // so its axis sits at the (x = r, y = r) corner of the prism.
    const profile = cylinderProfile(r, h, bevel, bevelSegs);
    const cyl = revolveProfile(wasm, profile, segs).translate([r, r, 0]);
    const block = Manifold.cube([r, r, h], false);
    const manifold = Manifold.difference(block, cyl).rotate([90, 0, 0]);
    return { manifold };
  },
  // Three frame (Y-up): square prism x,y ∈ [0, r], z ∈ [0, h] with a Z-axis
  // quarter-cylinder of radius r (axis at x = y = r) carved out, so the cove
  // faces up. Bevel ignored at the SDF level — the un-rounded primitive;
  // smooth-blending lives at the group level (see Cylinder/Box).
  sdf(geom) {
    const r = geom.params.radius ?? 10;
    const h = geom.params.height || 20;
    return {
      sample: (x, y, z) => sdFillet({ x, y, z }, r, h),
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: r, y: r, z: h } },
    };
  },
});
