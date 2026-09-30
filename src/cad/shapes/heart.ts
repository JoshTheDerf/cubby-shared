import type { HeartGeometry } from '../geometry';
import { defineShape } from './registry';
import { extrudeProfile, type Point2D } from './_helpers';

export const heartShape = defineShape<HeartGeometry>({
  id: 'heart',
  label: 'Heart', labelKey: 'primitives.heart',
  icon: 'i-lucide-heart',
  palette: true,
  defaults: { radius: 14, height: 10 },
  schema: {
    properties: {
      radius: { type: 'number', label: 'Radius', labelKey: 'params.radius', unit: 'mm', default: 14, min: 0.1, step: 1, sliderMax: 100 },
      height: { type: 'number', label: 'Height', labelKey: 'params.height', unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
    },
    order: ['radius', 'height'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const radius = p.radius ?? 14;
    const h = p.height ?? 10;
    const segs = 64;

    const raw: Point2D[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < segs; i++) {
      const t = 2 * Math.PI - (2 * Math.PI * i) / segs;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      raw.push([x, y]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const scale = (2 * radius) / Math.max(maxX - minX, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const profile: Point2D[] = raw.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]);
    return { manifold: extrudeProfile(wasm, profile, h) };
  },
});
