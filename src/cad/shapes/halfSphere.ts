import type { HalfSphereGeometry } from '../geometry';
import { defineShape } from './registry';
import { hemisphereProfile, revolveProfile } from './_helpers';
import { sdHalfSphere } from '../sdf/primitives';

export const halfSphereShape = defineShape<HalfSphereGeometry>({
  id: 'halfSphere',
  label: 'Half sphere', labelKey: 'primitives.halfSphere',
  icon: 'i-lucide-circle-dot',
  palette: true,
  defaults: { radius: 10, radialSegments: 32 },
  schema: {
    properties: {
      radius:         { type: 'number',  label: 'Radius', labelKey: 'params.radius',   unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      radialSegments: { type: 'integer', label: 'Segments', labelKey: 'params.segments',             default: 32, min: 3,   max: 256, step: 1 },
    },
    order: ['radius', 'radialSegments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const r = p.radius ?? 10;
    const segs = p.radialSegments ?? 32;
    const profile = hemisphereProfile(r, Math.max(4, Math.floor(segs / 4)));
    return { manifold: revolveProfile(wasm, profile, segs) };
  },
  // Three frame: hemispheric dome with flat base on y = 0 and the
  // top at y = r. Centre of the underlying full sphere is at the
  // origin; the analytic SDF clips that sphere to `y >= 0`. See
  // sdHalfSphere and compile.ts `case 'halfSphere'` for the mirror.
  sdf(geom) {
    const r = geom.params.radius ?? 10;
    const c = { x: 0, y: 0, z: 0 };
    return {
      sample: (x, y, z) => sdHalfSphere({ x, y, z }, c, r),
      bounds: { min: { x: -r, y: 0, z: -r }, max: { x: r, y: r, z: r } },
    };
  },
});
