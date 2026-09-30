import type { PolygonGeometry } from '../geometry';
import { defineShape } from './registry';
import { extrudeProfile, polygonProfile } from './_helpers';
import { sdPolygonPrism } from '../sdf/primitives';

export const polygonShape = defineShape<PolygonGeometry>({
  id: 'polygon',
  label: 'Polygon', labelKey: 'primitives.polygon',
  icon: 'i-lucide-hexagon',
  palette: true,
  defaults: { radius: 10, height: 20, sides: 6, bevel: 0, bevelSegments: 4 },
  schema: {
    properties: {
      radius:        { type: 'number',  label: 'Radius', labelKey: 'params.radius',          unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      height:        { type: 'number',  label: 'Height', labelKey: 'params.height',          unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      sides:         { type: 'integer', label: 'Sides', labelKey: 'params.sides',                       default: 6,  min: 3,   max: 64,  step: 1 },
      bevel:         { type: 'number',  label: 'Bevel', labelKey: 'params.bevel',           unit: 'mm', default: 0,  min: 0,   step: 0.5, sliderMax: 10 },
      bevelSegments: { type: 'integer', label: 'Bevel segments', labelKey: 'params.bevelSegments',              default: 4,  min: 1,   max: 32, step: 1 },
    },
    order: ['radius', 'height', 'sides', 'bevel', 'bevelSegments'],
  },
  build(geom, { wasm }) {
    const { Manifold } = wasm;
    const p = geom.params;
    const r = p.radius ?? 10;
    const h = p.height || 20;
    const sides = Math.max(3, p.sides || 6);
    const bevel = p.bevel ?? 0;
    const bevelSegs = p.bevelSegments ?? 4;

    if (bevel > 0 && bevelSegs > 0) {
      const insetFactor = 1 / Math.cos(Math.PI / sides);
      const maxBevel = Math.min(r / insetFactor, h / 2);
      const b = Math.min(bevel, maxBevel * 0.999);
      const rInset = r - b * insetFactor;
      const segs = Math.max(8, bevelSegs * 4);
      const sphere = Manifold.sphere(b, segs);
      const balls: any[] = [];
      for (let i = 0; i < sides; i++) {
        const a = (2 * Math.PI * i) / sides - Math.PI / 2;
        const x = rInset * Math.cos(a);
        const y = rInset * Math.sin(a);
        balls.push(sphere.translate([x, y, b]));
        balls.push(sphere.translate([x, y, h - b]));
      }
      return { manifold: Manifold.hull(balls) };
    }
    return { manifold: extrudeProfile(wasm, polygonProfile(r, sides), h) };
  },
  // Three frame: regular N-gon in the XZ plane, vertex 0 at (0, 0, r)
  // (polygonProfile's CAD (0, -r) → Three (0, 0, r) after factory
  // CAD→Three). Extruded along Y from y = 0 to y = h. Closed-form IQ
  // 2D polygon SDF + a Y slab. Bevel is omitted (lattice path picks
  // bevelled polygons up).
  sdf(geom) {
    const p = geom.params;
    const r = p.radius ?? 10;
    const sides = Math.max(3, p.sides ?? 6);
    const h = p.height ?? 20;
    return {
      sample: (x, y, z) => sdPolygonPrism({ x, y, z }, r, sides, h),
      bounds: { min: { x: -r, y: 0, z: -r }, max: { x: r, y: h, z: r } },
    };
  },
});
