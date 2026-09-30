import type { HalfCylinderGeometry } from '../geometry';
import { defineShape } from './registry';
import { extrudeProfile, type Point2D } from './_helpers';
import { sdHalfCylinderEll } from '../sdf/primitives';

export const halfCylinderShape = defineShape<HalfCylinderGeometry>({
  id: 'halfCylinder',
  label: 'Half cylinder', labelKey: 'primitives.halfCylinder',
  icon: 'i-lucide-disc-half',
  palette: true,
  defaults: { radius: 10, height: 10, depth: 20, radialSegments: 32 },
  schema: {
    properties: {
      radius:         { type: 'number',  label: 'Radius', labelKey: 'params.radius',   unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      height:         { type: 'number',  label: 'Height', labelKey: 'params.height',   unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      depth:          { type: 'number',  label: 'Depth', labelKey: 'params.depth',    unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      radialSegments: { type: 'integer', label: 'Segments', labelKey: 'params.segments',             default: 32, min: 3,   max: 256, step: 1 },
    },
    order: ['radius', 'height', 'depth', 'radialSegments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const radius = p.radius ?? 10;
    const height = p.height ?? radius;
    const depth = p.depth ?? 20;
    const segs = Math.max(8, p.radialSegments ?? 32);

    const profile: Point2D[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (Math.PI * i) / segs;
      profile.push([radius * Math.cos(a), height * Math.sin(a)]);
    }
    // Build the half-dome in Three-frame orientation as before (extruded
    // half-disc, then centered along the extrusion axis), then rotate
    // +90° about X to land in CAD frame for the factory seam.
    const manifold = extrudeProfile(wasm, profile, depth)
      .translate([0, 0, -depth / 2])
      .rotate([90, 0, 0]);
    return { manifold };
  },
  // Three frame: half-ellipse prism with the half-ellipse in XY
  // (rx = `radius`, ry = `height`, dome facing +y), extruded along Z
  // with z ∈ [-depth/2, depth/2]. The 2D ellipse SDF is approximate
  // (IQ "bound" formulation) — sign-correct, exact at the surface,
  // biased farther out. Sufficient for surface extraction; the
  // smooth-blend window of typical groups stays inside the
  // well-behaved region. See sdHalfCylinderEll for the math.
  sdf(geom) {
    const p = geom.params;
    const rx = p.radius ?? 10;
    const ry = p.height ?? rx;
    const d = p.depth ?? 20;
    const c = { x: 0, y: 0, z: 0 };
    return {
      sample: (x, y, z) => sdHalfCylinderEll({ x, y, z }, c, rx, ry, d / 2),
      bounds: { min: { x: -rx, y: 0, z: -d / 2 },
                max: { x:  rx, y: ry, z:  d / 2 } },
    };
  },
});
