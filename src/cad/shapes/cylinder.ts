import type { CylinderGeometry } from '../geometry';
import { defineShape } from './registry';
import { cylinderProfile, revolveProfile } from './_helpers';
import { sdCylinder } from '../sdf/primitives';

export const cylinderShape = defineShape<CylinderGeometry>({
  id: 'cylinder',
  label: 'Cylinder', labelKey: 'primitives.cylinder',
  icon: 'i-lucide-cylinder',
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
    const p = geom.params;
    const r = p.radius ?? 10;
    const h = p.height || 20;
    const segs = p.radialSegments || 32;
    const bevel = p.bevel ?? 0;
    const bevelSegs = p.bevelSegments ?? 1;
    const profile = cylinderProfile(r, h, bevel, bevelSegs);
    return { manifold: revolveProfile(wasm, profile, segs) };
  },
  // Cylinder mesh sits with base at z = 0 and top at z = h. Bevel is
  // ignored at the SDF level — see Box for the rationale.
  sdf(geom) {
    // Three frame (Y-up): cylinder axis is along +Y; base at y = 0,
    // top at y = h. Bevel ignored — the SDF is the un-rounded primitive
    // and smooth-blending lives at the group level.
    const r = geom.params.radius ?? 10;
    const h = geom.params.height || 20;
    const c = { x: 0, y: h / 2, z: 0 };
    return {
      sample: (x, y, z) => sdCylinder({ x, y, z }, c, r, h / 2),
      bounds: { min: { x: -r, y: 0, z: -r }, max: { x: r, y: h, z: r } },
    };
  },
});
