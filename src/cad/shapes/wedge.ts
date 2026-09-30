import type { WedgeGeometry } from '../geometry';
import { defineShape } from './registry';
import { extrudeProfile, type Point2D } from './_helpers';
import { sdWedge } from '../sdf/primitives';

export const wedgeShape = defineShape<WedgeGeometry>({
  id: 'wedge',
  label: 'Wedge', labelKey: 'primitives.wedge',
  icon: 'i-lucide-slice',
  palette: true,
  defaults: { width: 20, height: 20, depth: 20 },
  schema: {
    properties: {
      width:  { type: 'number', label: 'Width', labelKey: 'params.width',  unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      height: { type: 'number', label: 'Height', labelKey: 'params.height', unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      depth:  { type: 'number', label: 'Depth', labelKey: 'params.depth',  unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
    },
    order: ['width', 'height', 'depth'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const w = p.width || 20;
    const h = p.height || 20;
    const d = p.depth || 20;
    // Build the wedge in Three-frame orientation as before (extrude an
    // XY triangle along Z, rotate about Y to orient the slope, recenter),
    // then a final +90° about X moves the whole thing into CAD frame so
    // the factory's default CAD→Three rotation produces the same visual
    // output.
    const profile: Point2D[] = [[0, 0], [d, 0], [0, h]];
    const manifold = extrudeProfile(wasm, profile, w)
      .rotate([0, 90, 0])
      .translate([0, 0, d / 2])
      .rotate([90, 0, 0]);
    return { manifold };
  },
  // Three frame: right-triangular prism. Cross-section in YZ plane
  // has vertices (y=0, z=-d/2), (y=0, z=+d/2), (y=h, z=+d/2).
  // Extruded along X from x=0 to x=w (so the slant rises along +Z as
  // y rises). See sdWedge for the half-space derivation.
  sdf(geom) {
    const p = geom.params;
    const w = p.width || 20;
    const h = p.height || 20;
    const d = p.depth || 20;
    return {
      sample: (x, y, z) => sdWedge({ x, y, z }, w, h, d),
      bounds: { min: { x: 0, y: 0, z: -d / 2 },
                max: { x: w, y: h, z:  d / 2 } },
    };
  },
});
