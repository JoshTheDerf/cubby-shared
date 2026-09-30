import type { BoxGeometry } from '../geometry';
import { defineShape } from './registry';
import { extrudeProfile, rectProfile } from './_helpers';
import { sdBox } from '../sdf/primitives';

export const boxShape = defineShape<BoxGeometry>({
  id: 'box',
  label: 'Box', labelKey: 'primitives.box',
  icon: 'i-lucide-box',
  palette: true,
  defaults: { width: 20, height: 20, depth: 20, bevel: 0, bevelSegments: 4 },
  schema: {
    properties: {
      width:         { type: 'number',  label: 'Width', labelKey: 'params.width',  unit: 'mm', default: 20, min: 0.1, step: 1,   sliderMax: 100 },
      height:        { type: 'number',  label: 'Height', labelKey: 'params.height', unit: 'mm', default: 20, min: 0.1, step: 1,   sliderMax: 100 },
      depth:         { type: 'number',  label: 'Depth', labelKey: 'params.depth',  unit: 'mm', default: 20, min: 0.1, step: 1,   sliderMax: 100 },
      bevel:         { type: 'number',  label: 'Bevel', labelKey: 'params.bevel',  unit: 'mm', default: 0,  min: 0,   step: 0.5, sliderMax: 10  },
      bevelSegments: { type: 'integer', label: 'Bevel segments', labelKey: 'params.bevelSegments',     default: 4,  min: 1,   max: 32,   step: 1        },
    },
    order: ['width', 'height', 'depth', 'bevel', 'bevelSegments'],
  },
  build(geom, { wasm }) {
    const { Manifold } = wasm;
    const p = geom.params;
    const w = p.width || 20;
    const h = p.height || 20;
    const d = p.depth || 20;
    const bevel = p.bevel ?? 0;
    const bevelSegs = p.bevelSegments ?? 4;

    let manifold;
    if (bevel > 0 && bevelSegs > 0) {
      const r = Math.min(bevel, w / 2, d / 2, h / 2);
      const hw = (w - 2 * r) / 2;
      const hh = (h - 2 * r) / 2;
      const hd = (d - 2 * r) / 2;

      const segs = Math.max(8, bevelSegs * 4);
      const sphere = Manifold.sphere(r, segs);

      const corners: [number, number, number][] = [];
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            corners.push([sx * hw, sy * hd, sz * hh]);
          }
        }
      }
      manifold = Manifold.hull(corners.map((c) => sphere.translate(c)));
      manifold = manifold.translate([0, 0, h / 2]);
    } else {
      manifold = extrudeProfile(wasm, rectProfile(w, d, true), h);
    }
    return { manifold };
  },
  // Box SDF in CAD frame: rectProfile is centred in XY, extrusion takes
  // z from 0 to h. Centre at (0, 0, h/2). Bevel intentionally ignored
  // (the SDF reports the un-rounded box; the resulting smooth-blended
  // surface in SDF mode already softens corners via blendK, and SDF
  // mode is the right consumer-side bevel control).
  sdf(geom) {
    // Three frame (Y-up); see Sphere for the CAD→Three rationale. The
    // Manifold is built in CAD then rotated, so width stays on X, the
    // CAD-depth axis becomes Three-Z, and the CAD-height axis becomes
    // Three-Y (bottom on y = 0). Bevel intentionally ignored — see
    // earlier note.
    const w = geom.params.width || 20;
    const h = geom.params.height || 20;
    const d = geom.params.depth || 20;
    const c = { x: 0, y: h / 2, z: 0 };
    const half = { x: w / 2, y: h / 2, z: d / 2 };
    return {
      sample: (x, y, z) => sdBox({ x, y, z }, c, half),
      bounds: {
        min: { x: -half.x, y: 0, z: -half.z },
        max: { x:  half.x, y: h, z:  half.z },
      },
    };
  },
});
