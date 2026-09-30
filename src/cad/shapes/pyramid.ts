import type { PyramidGeometry } from '../geometry';
import { defineShape } from './registry';
import { coneProfile, revolveProfile } from './_helpers';
import { sdCappedCone } from '../sdf/primitives';

export const pyramidShape = defineShape<PyramidGeometry>({
  id: 'pyramid',
  label: 'Pyramid', labelKey: 'primitives.pyramid',
  icon: 'i-lucide-triangle',
  palette: true,
  defaults: { radius: 10, height: 20, sides: 4 },
  schema: {
    properties: {
      radius: { type: 'number',  label: 'Radius', labelKey: 'params.radius', unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      height: { type: 'number',  label: 'Height', labelKey: 'params.height', unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      sides:  { type: 'integer', label: 'Sides', labelKey: 'params.sides',              default: 4,  min: 3,   max: 32, step: 1 },
    },
    order: ['radius', 'height', 'sides'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const r = p.radius ?? 10;
    const h = p.height || 20;
    const sides = p.sides || 4;
    const vertexRadius = r / Math.cos(Math.PI / sides);
    const profile = coneProfile(vertexRadius, 0, h);
    return { manifold: revolveProfile(wasm, profile, sides).rotate([0, 0, 180 / sides]) };
  },
  // Three frame: pyramid is an N-sided cone after `revolveProfile`
  // with `sides` segments — base at y = 0, apex at y = h, base
  // vertex-circumradius = r/cos(π/N). The analytic SDF treats it as
  // the limiting smooth cone (sdCappedCone with rTop = 0); silhouette
  // facets are lost in the SDF but the surface position matches the
  // mesh's at every face plane through the apex.
  sdf(geom) {
    const p = geom.params;
    const r = p.radius ?? 10;
    const h = p.height || 20;
    const sides = Math.max(3, p.sides ?? 4);
    const rBottom = r / Math.cos(Math.PI / sides);
    const c = { x: 0, y: h / 2, z: 0 };
    return {
      sample: (x, y, z) => sdCappedCone({ x, y, z }, c, rBottom, 0, h / 2),
      bounds: { min: { x: -rBottom, y: 0, z: -rBottom },
                max: { x:  rBottom, y: h, z:  rBottom } },
    };
  },
});
