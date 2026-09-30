import type { TubeGeometry } from '../geometry';
import { defineShape } from './registry';
import { arcPoints, revolveProfile, type Point2D } from './_helpers';
import { sdTube } from '../sdf/primitives';

export const tubeShape = defineShape<TubeGeometry>({
  id: 'tube',
  label: 'Tube', labelKey: 'primitives.tube',
  icon: 'i-lucide-circle-dashed',
  palette: true,
  defaults: { radius: 10, thickness: 2.5, height: 10, radialSegments: 48, bevel: 0, bevelSegments: 4 },
  schema: {
    properties: {
      radius:         { type: 'number',  label: 'Outer radius', labelKey: 'params.outerRadius',   unit: 'mm', default: 10,  min: 0.1, step: 1, sliderMax: 100 },
      thickness:      { type: 'number',  label: 'Wall thickness', labelKey: 'params.wallThickness', unit: 'mm', default: 2.5, min: 0.1, step: 0.5, sliderMax: 20 },
      height:         { type: 'number',  label: 'Height', labelKey: 'params.height',         unit: 'mm', default: 10,  min: 0.1, step: 1, sliderMax: 100 },
      radialSegments: { type: 'integer', label: 'Segments', labelKey: 'params.segments',                   default: 48,  min: 3,   max: 256, step: 1 },
      bevel:          { type: 'number',  label: 'Bevel', labelKey: 'params.bevel',          unit: 'mm', default: 0,   min: 0,   step: 0.5, sliderMax: 10 },
      bevelSegments:  { type: 'integer', label: 'Bevel segments', labelKey: 'params.bevelSegments',             default: 4,   min: 1,   max: 32, step: 1 },
    },
    order: ['radius', 'thickness', 'height', 'radialSegments', 'bevel', 'bevelSegments'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const rOuter = p.radius ?? 10;
    const thickness = p.thickness ?? 2.5;
    const h = p.height ?? 10;
    const segs = p.radialSegments ?? 48;
    const rInner = Math.max(0, rOuter - thickness);
    const bevel = p.bevel ?? 0;
    const bevelSegs = p.bevelSegments ?? 4;

    const b = Math.min(bevel, thickness / 2, h / 2);
    let profile: Point2D[];
    if (b > 0 && bevelSegs > 0) {
      const cInsideOut = rInner + b, cOutsideOut = rOuter - b;
      const cBot = b, cTop = h - b;
      profile = [];
      profile.push(...arcPoints(cInsideOut, cBot, b, Math.PI, 1.5 * Math.PI, bevelSegs));
      profile.push(...arcPoints(cOutsideOut, cBot, b, 1.5 * Math.PI, 2 * Math.PI, bevelSegs));
      profile.push(...arcPoints(cOutsideOut, cTop, b, 0, 0.5 * Math.PI, bevelSegs));
      profile.push(...arcPoints(cInsideOut, cTop, b, 0.5 * Math.PI, Math.PI, bevelSegs));
    } else {
      profile = [[rInner, 0], [rOuter, 0], [rOuter, h], [rInner, h]];
    }
    return { manifold: revolveProfile(wasm, profile, segs) };
  },
  // Three frame: Y-axis tube, base at y = 0, top at y = h, outer
  // radius `radius`, inner = outer − thickness. Bevel is omitted from
  // the SDF (matches box / cylinder convention: smooth-blending in the
  // group level is the SDF-side bevel control).
  sdf(geom) {
    const p = geom.params;
    const rOuter = p.radius ?? 10;
    const thickness = p.thickness ?? 2.5;
    const rInner = Math.max(0, rOuter - thickness);
    const h = p.height ?? 10;
    const c = { x: 0, y: h / 2, z: 0 };
    return {
      sample: (x, y, z) => sdTube({ x, y, z }, c, rOuter, rInner, h / 2),
      bounds: { min: { x: -rOuter, y: 0, z: -rOuter },
                max: { x:  rOuter, y: h, z:  rOuter } },
    };
  },
});
