import type { RingGeometry } from '../geometry';
import { defineShape } from './registry';
import { revolveProfile, signedArea, type Point2D } from './_helpers';

/**
 * TinkerCad's ring/torus generator. Pattern is pre-discretized at import time,
 * so this shape is closed — there's no in-app editor and `palette` is false.
 */
export const ringShape = defineShape<RingGeometry>({
  id: 'ring',
  label: 'Ring', labelKey: 'primitives.ring',
  icon: 'i-lucide-donut',
  palette: false,
  defaults: { radius: 10, segments: 48 },
  build(geom, { wasm }) {
    const p = geom.params;
    const radius = p.radius ?? 10;
    const segs = p.segments ?? 48;
    const pattern = geom.pattern;
    if (!pattern || pattern.length < 3) {
      console.warn('ring: empty or degenerate pattern');
      return null;
    }
    const PATTERN_SCALE = 0.25;
    let minY = Infinity;
    for (const [, y] of pattern) {
      const sy = y * PATTERN_SCALE;
      if (sy < minY) minY = sy;
    }
    let profile: Point2D[] = pattern.map(
      ([x, y]) => [x * PATTERN_SCALE + radius, y * PATTERN_SCALE - minY],
    );
    if (signedArea(profile) < 0) profile = profile.slice().reverse();
    return { manifold: revolveProfile(wasm, profile, segs) };
  },
});
