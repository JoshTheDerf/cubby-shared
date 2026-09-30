import type { ParaboloidGeometry } from '../geometry';
import { defineShape } from './registry';
import { revolveProfile, type Point2D } from './_helpers';
import { sdParaboloid } from '../sdf/primitives';

export const paraboloidShape = defineShape<ParaboloidGeometry>({
  id: 'paraboloid',
  label: 'Paraboloid', labelKey: 'primitives.paraboloid',
  icon: 'i-lucide-droplet',
  palette: true,
  defaults: { radius: 10, height: 20, radialSegments: 48 },
  schema: {
    properties: {
      radius:         { type: 'number',  label: 'Radius', labelKey: 'params.radius',   unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      height:         { type: 'number',  label: 'Height', labelKey: 'params.height',   unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      radialSegments: { type: 'integer', label: 'Segments', labelKey: 'params.segments',             default: 48, min: 3,   max: 256, step: 1 },
    },
    order: ['radius', 'height', 'radialSegments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const radius = p.radius ?? 10;
    const height = p.height ?? 20;
    const radialSegs = p.radialSegments ?? 48;
    const profileSegs = 16;
    const profile: Point2D[] = [[0, 0]];
    for (let i = 0; i <= profileSegs; i++) {
      const x = radius * (1 - i / profileSegs);
      const y = height * (1 - (x * x) / (radius * radius));
      profile.push([x, y]);
    }
    return { manifold: revolveProfile(wasm, profile, radialSegs) };
  },
  // Three frame: paraboloid of revolution, flat base at y = 0 with
  // outer radius `radius`, apex at y = `height`. Profile follows
  // y = h * (1 − (r / R)²). Analytic SDF uses the same IQ ellipse-
  // bound formulation `sdEllipsoid` uses — sign-correct + exact at
  // the surface, smooth-blend friendly.
  sdf(geom) {
    const r = geom.params.radius ?? 10;
    const h = geom.params.height ?? 20;
    const c = { x: 0, y: 0, z: 0 };
    return {
      sample: (x, y, z) => sdParaboloid({ x, y, z }, c, r, h),
      bounds: { min: { x: -r, y: 0, z: -r }, max: { x: r, y: h, z: r } },
    };
  },
});
