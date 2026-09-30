import type { TorusGeometry } from '../geometry';
import { defineShape } from './registry';
import { revolveProfile, type Point2D } from './_helpers';
import { sdTorus } from '../sdf/primitives';

export const torusShape = defineShape<TorusGeometry>({
  id: 'torus',
  label: 'Torus', labelKey: 'primitives.torus',
  icon: 'i-lucide-donut',
  palette: true,
  defaults: { radius: 10, tube: 2.5, radialSegments: 24, tubularSegments: 48 },
  schema: {
    properties: {
      radius:          { type: 'number',  label: 'Ring radius', labelKey: 'params.ringRadius',    unit: 'mm', default: 10,  min: 0.1, step: 1,   sliderMax: 100 },
      tube:            { type: 'number',  label: 'Tube radius', labelKey: 'params.tubeRadius',    unit: 'mm', default: 2.5, min: 0.1, step: 0.5, sliderMax: 50  },
      radialSegments:  { type: 'integer', label: 'Tube segments', labelKey: 'params.tubeSegments',              default: 24,  min: 3,   max: 64,   step: 1 },
      tubularSegments: { type: 'integer', label: 'Ring segments', labelKey: 'params.ringSegments',              default: 48,  min: 3,   max: 256,  step: 1 },
    },
    order: ['radius', 'tube', 'radialSegments', 'tubularSegments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const R = p.radius ?? 10;
    const r = p.tube ?? 2.5;
    const radialSegs = p.radialSegments ?? 24;
    const tubularSegs = p.tubularSegments ?? 48;
    const profile: Point2D[] = [];
    for (let i = 0; i < radialSegs; i++) {
      const a = (2 * Math.PI * i) / radialSegs;
      profile.push([R + r * Math.cos(a), r * Math.sin(a)]);
    }
    const manifold = revolveProfile(wasm, profile, tubularSegs).translate([0, 0, r]);
    return { manifold };
  },
  // Mesh is translated up by tube radius so the torus sits on z = 0.
  // Centre the SDF at (0, 0, tube) to match.
  sdf(geom) {
    // Three frame (Y-up): ring around +Y axis. Mesh is built bottom-
    // snapped (the `.translate([0, 0, r])` in build() becomes a
    // y-translate after CAD→Three rotation), so the torus rests on
    // y = 0 with the centerline at y = r.
    const R = geom.params.radius ?? 10;
    const r = geom.params.tube ?? 2.5;
    const c = { x: 0, y: r, z: 0 };
    const outer = R + r;
    return {
      sample: (x, y, z) => sdTorus({ x, y, z }, c, R, r),
      bounds: {
        min: { x: -outer, y: 0,     z: -outer },
        max: { x:  outer, y: 2 * r, z:  outer },
      },
    };
  },
});
