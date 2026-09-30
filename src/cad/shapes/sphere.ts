import type { SphereGeometry } from '../geometry';
import { defineShape } from './registry';
import { revolveProfile, type Point2D } from './_helpers';
import { sdSphere } from '../sdf/primitives';

export const sphereShape = defineShape<SphereGeometry>({
  id: 'sphere',
  label: 'Sphere', labelKey: 'primitives.sphere',
  icon: 'i-lucide-circle',
  palette: true,
  defaults: { radius: 10, radialSegments: 48, verticalSegments: 24 },
  schema: {
    properties: {
      radius:           { type: 'number',  label: 'Radius', labelKey: 'params.radius',              unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      radialSegments:   { type: 'integer', label: 'Longitude segments', labelKey: 'params.longitudeSegments',              default: 48, min: 3,   max: 256, step: 1 },
      verticalSegments: { type: 'integer', label: 'Latitude segments', labelKey: 'params.latitudeSegments',               default: 24, min: 2,   max: 128, step: 1 },
    },
    order: ['radius', 'radialSegments', 'verticalSegments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const r = p.radius ?? 10;
    const lat = Math.max(4, p.verticalSegments ?? 24);
    const lon = Math.max(3, p.radialSegments ?? lat * 2);
    const profile: Point2D[] = [];
    for (let i = 0; i <= lat; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / lat;
      profile.push([r * Math.cos(a), r + r * Math.sin(a)]);
    }
    return { manifold: revolveProfile(wasm, profile, lon) };
  },
  // The CSG pipeline (manifold cache, child transforms, group composition)
  // operates in Three frame (Y-up) — `GeometryFactory.createGeometry`
  // rotates each primitive's Manifold from CAD into Three frame before
  // it ever enters the CSG layer, so SDFs registered here must match.
  // The mesh sits bottom-snapped at y = 0 with the centre at (0, r, 0).
  sdf(geom) {
    const r = geom.params.radius ?? 10;
    const c = { x: 0, y: r, z: 0 };
    return {
      sample: (x, y, z) => sdSphere({ x, y, z }, c, r),
      bounds: { min: { x: -r, y: 0, z: -r }, max: { x: r, y: 2 * r, z: r } },
    };
  },
});
