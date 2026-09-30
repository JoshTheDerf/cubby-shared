import type { ExtrudeStarGeometry } from '../geometry';
import { defineShape } from './registry';
import { extrudeProfile, type Point2D } from './_helpers';
import { sdStarPrism } from '../sdf/primitives';

export const extrudeStarShape = defineShape<ExtrudeStarGeometry>({
  id: 'extrudeStar',
  label: 'Star (flat)', labelKey: 'primitives.starFlat',
  icon: 'i-lucide-star-half',
  palette: true,
  defaults: { sides: 5, radius: 10, innerRadius: 0.5, height: 10 },
  schema: {
    properties: {
      radius:      { type: 'number',  label: 'Outer radius', labelKey: 'params.outerRadius',        unit: 'mm', default: 10,  min: 0.1,  step: 1,    sliderMax: 100 },
      innerRadius: { type: 'number',  label: 'Inner / outer ratio', labelKey: 'params.innerOuterRatio',             default: 0.5, min: 0.01, max: 1,     step: 0.05 },
      height:      { type: 'number',  label: 'Height', labelKey: 'params.height',              unit: 'mm', default: 10,  min: 0.1,  step: 1,    sliderMax: 100 },
      sides:       { type: 'integer', label: 'Points', labelKey: 'params.points',                          default: 5,   min: 3,    max: 32,    step: 1 },
    },
    order: ['radius', 'innerRadius', 'height', 'sides'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const sides = Math.max(3, p.sides ?? 5);
    const outer = p.radius ?? 10;
    const innerRatio = p.innerRadius ?? 0.5;
    const inner = outer * Math.max(0.001, Math.min(1, innerRatio));
    const h = p.height ?? 10;
    const startAngle = Math.PI / 2 - Math.PI / 10;

    const profile: Point2D[] = [];
    const n = sides * 2;
    for (let i = 0; i < n; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = startAngle + (2 * Math.PI * i) / n;
      profile.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return { manifold: extrudeProfile(wasm, profile, h) };
  },
  // Three frame: N-pointed star prism in the XZ plane (built from
  // CAD XY then rotated through the factory seam), extruded along Y
  // from y = 0 to y = h. Uses IQ's analytic 2D star SDF; sign-correct
  // with the exact zero crossing on each point and valley.
  sdf(geom) {
    const p = geom.params;
    const r = p.radius ?? 10;
    const innerRatio = p.innerRadius ?? 0.5;
    const sides = Math.max(3, p.sides ?? 5);
    const h = p.height ?? 10;
    return {
      sample: (x, y, z) => sdStarPrism({ x, y, z }, r, innerRatio, sides, h),
      bounds: { min: { x: -r, y: 0, z: -r }, max: { x: r, y: h, z: r } },
    };
  },
});
