import type { RoofGeometry } from '../geometry';
import { defineShape } from './registry';
import { extrudeProfile, type Point2D } from './_helpers';
import { sdRoof } from '../sdf/primitives';

export const roofShape = defineShape<RoofGeometry>({
  id: 'roof',
  label: 'Roof', labelKey: 'primitives.roof',
  icon: 'i-lucide-home',
  palette: true,
  defaults: { width: 20, height: 10, depth: 20 },
  schema: {
    properties: {
      width:  { type: 'number', label: 'Width', labelKey: 'params.width',  unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
      height: { type: 'number', label: 'Height', labelKey: 'params.height', unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      depth:  { type: 'number', label: 'Depth', labelKey: 'params.depth',  unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
    },
    order: ['width', 'height', 'depth'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const w = p.width || 20;
    const h = p.height || 10;
    const d = p.depth || 20;
    // Profile = width × height triangle, conceptually in CAD's XZ plane.
    // extrudeProfile draws in XY and extrudes along Z, so a +90° rotation
    // about X remaps (X=width, Y=height_old, Z=depth_old) into the CAD
    // frame (X=width, Y=depth, Z=height) before the default CAD→Three
    // rotation is applied at the factory seam.
    const profile: Point2D[] = [[-w / 2, 0], [w / 2, 0], [0, h]];
    return { manifold: extrudeProfile(wasm, profile, d).rotate([90, 0, 0]) };
  },
  // Three frame: isoceles triangular prism. Base of width w along X
  // at y = 0, apex at (0, h, *). Extruded along Z from z = 0 to z = d.
  sdf(geom) {
    const p = geom.params;
    const w = p.width || 20;
    const h = p.height || 10;
    const d = p.depth || 20;
    return {
      sample: (x, y, z) => sdRoof({ x, y, z }, w, h, d),
      bounds: { min: { x: -w / 2, y: 0, z: 0 },
                max: { x:  w / 2, y: h, z: d } },
    };
  },
});
