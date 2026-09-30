import type { IcosahedronGeometry } from '../geometry';
import { defineShape } from './registry';
import { buildVertPropsWhite } from './_helpers';
import { buildGeneratedSolid } from '../manifold/manifoldComponents';

export const icosahedronShape = defineShape<IcosahedronGeometry>({
  id: 'icosahedron',
  label: 'Icosahedron', labelKey: 'primitives.icosahedron',
  icon: 'i-lucide-gem',
  palette: true,
  defaults: { radius: 10 },
  schema: {
    properties: {
      radius: { type: 'number', label: 'Radius', labelKey: 'params.radius', unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
    },
    order: ['radius'],
  },
  build(geom, { wasm }) {
    const r = geom.params.radius ?? 10;
    const phi = (1 + Math.sqrt(5)) / 2;
    const norm = Math.sqrt(1 + phi * phi);
    const s = r / norm;
    const v: [number, number, number][] = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ].map(([x, y, z]) => [x * s, y * s, z * s]);
    const faces: [number, number, number][] = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const vertProps = buildVertPropsWhite(v);
    const triVerts = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
      triVerts[i * 3] = faces[i][0];
      triVerts[i * 3 + 1] = faces[i][1];
      triVerts[i * 3 + 2] = faces[i][2];
    }
    const solid = buildGeneratedSolid(wasm, { numProp: 6, vertProperties: vertProps, triVerts }, 'icosahedron');
    let ico = solid.rotate([90, 0, 45]);
    const bb = ico.boundingBox();
    ico = ico.translate([0, 0, -bb.min[2]]);
    return { manifold: ico };
  },
});
