import type { ConeGeometry } from '../geometry';
import { defineShape } from './registry';
import { coneProfile, revolveProfile } from './_helpers';
import { sdCappedCone } from '../sdf/primitives';

export const coneShape = defineShape<ConeGeometry>({
  id: 'cone',
  label: 'Cone', labelKey: 'primitives.cone',
  icon: 'i-lucide-cone',
  palette: true,
  defaults: { radiusTop: 0, radiusBottom: 10, height: 20, radialSegments: 32 },
  schema: {
    properties: {
      radiusTop:      { type: 'number',  label: 'Top radius', labelKey: 'params.topRadius',    unit: 'mm', default: 0,  min: 0,   step: 1, sliderMax: 100 },
      radiusBottom:   { type: 'number',  label: 'Bottom radius', labelKey: 'params.bottomRadius', unit: 'mm', default: 10, min: 0,   step: 1, sliderMax: 100 },
      height:         { type: 'number',  label: 'Height', labelKey: 'params.height',        unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      radialSegments: { type: 'integer', label: 'Segments', labelKey: 'params.segments',                  default: 32, min: 3,   max: 256, step: 1 },
    },
    order: ['radiusTop', 'radiusBottom', 'height', 'radialSegments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const rTop = p.radiusTop ?? 0;
    const rBottom = p.radiusBottom ?? 10;
    const h = p.height || 20;
    const segs = p.radialSegments || 32;
    return { manifold: revolveProfile(wasm, coneProfile(rBottom, rTop, h), segs) };
  },
  // coneProfile extrudes/revolves from z = 0 (base, radius = rBottom)
  // to z = h (top, radius = rTop). Centre the SDF at (0, 0, h/2) so
  // halfHeight = h/2 puts the bottom at -h/2 and top at +h/2 relative
  // to the centre — sdCappedConeZ's coordinate convention.
  sdf(geom) {
    // Three frame (Y-up): cone axis along +Y, base at y = 0 (radius =
    // radiusBottom), top at y = h (radius = radiusTop). Centre is the
    // midpoint, so halfHeight = h/2 puts the bottom at -h/2 and top at
    // +h/2 relative to the centre — sdCappedCone's convention.
    const rTop = geom.params.radiusTop ?? 0;
    const rBottom = geom.params.radiusBottom ?? 10;
    const h = geom.params.height || 20;
    const c = { x: 0, y: h / 2, z: 0 };
    const rMax = Math.max(rTop, rBottom);
    return {
      sample: (x, y, z) => sdCappedCone({ x, y, z }, c, rBottom, rTop, h / 2),
      bounds: { min: { x: -rMax, y: 0, z: -rMax }, max: { x: rMax, y: h, z: rMax } },
    };
  },
});
