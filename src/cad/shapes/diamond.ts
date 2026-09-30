import type { DiamondGeometry } from '../geometry';
import { defineShape } from './registry';
import { buildVertPropsWhite } from './_helpers';
import { buildGeneratedSolid } from '../manifold/manifoldComponents';

export const diamondShape = defineShape<DiamondGeometry>({
  id: 'diamond',
  label: 'Diamond', labelKey: 'primitives.diamond',
  icon: 'i-lucide-diamond',
  palette: true,
  defaults: { radius: 10, height: 20 },
  schema: {
    properties: {
      radius: { type: 'number', label: 'Radius', labelKey: 'params.radius', unit: 'mm', default: 10, min: 0.1, step: 1, sliderMax: 100 },
      height: { type: 'number', label: 'Height', labelKey: 'params.height', unit: 'mm', default: 20, min: 0.1, step: 1, sliderMax: 100 },
    },
    order: ['radius', 'height'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const r = p.radius ?? 10;
    const h = p.height ?? 20;
    const N = 16;
    const TABLE_RATIO = 0.55;
    const PAVILION_FRACTION = 0.7;
    const pavilionH = h * PAVILION_FRACTION;
    const tableR = r * TABLE_RATIO;

    const numVerts = 2 * N + 2;
    const verts: number[][] = new Array(numVerts);
    verts[0] = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N;
      verts[1 + i]     = [r * Math.cos(a),      r * Math.sin(a),      pavilionH];
      verts[1 + N + i] = [tableR * Math.cos(a), tableR * Math.sin(a), h];
    }
    const tableCenter = 2 * N + 1;
    verts[tableCenter] = [0, 0, h];
    const vp = buildVertPropsWhite(verts);

    const numTris = N + 2 * N + N;
    const tv = new Uint32Array(numTris * 3);
    let t = 0;
    for (let i = 0; i < N; i++) {
      const g0 = 1 + i;
      const g1 = 1 + ((i + 1) % N);
      const tA = 1 + N + i;
      const tB = 1 + N + ((i + 1) % N);
      tv[t++] = 0; tv[t++] = g1; tv[t++] = g0;
      tv[t++] = g0; tv[t++] = g1; tv[t++] = tB;
      tv[t++] = g0; tv[t++] = tB; tv[t++] = tA;
      tv[t++] = tableCenter; tv[t++] = tA; tv[t++] = tB;
    }
    return { manifold: buildGeneratedSolid(wasm, { numProp: 6, vertProperties: vp, triVerts: tv }, 'diamond') };
  },
});
