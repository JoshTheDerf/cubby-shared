import type { StarGeometry } from '../geometry';
import { defineShape } from './registry';
import { buildVertPropsWhite } from './_helpers';
import { buildGeneratedSolid } from '../manifold/manifoldComponents';

export const starShape = defineShape<StarGeometry>({
  id: 'star',
  label: 'Star', labelKey: 'primitives.star',
  icon: 'i-lucide-star',
  palette: true,
  defaults: { sides: 5, radius: 10, innerRadius: 0.5, height: 10 },
  schema: {
    properties: {
      radius:      { type: 'number',  label: 'Outer radius', labelKey: 'params.outerRadius',        unit: 'mm', default: 10,  min: 0.1,  step: 1,    sliderMax: 100 },
      innerRadius: { type: 'number',  label: 'Inner / outer ratio', labelKey: 'params.innerOuterRatio',             default: 0.5, min: 0.01, max: 1,     step: 0.05 },
      height:      { type: 'number',  label: 'Height', labelKey: 'params.height',              unit: 'mm', default: 10,  min: 0.1,  step: 1,    sliderMax: 100 },
      sides:       { type: 'integer', label: 'Points', labelKey: 'params.points',                          default: 5,   min: 3,    max: 32,    step: 1 },
    },
    order: ['radius', 'innerRadius', 'height', 'sides'],
  },
  build(geom, { wasm }) {
    const p = geom.params;
    const sides = Math.max(3, p.sides ?? 5);
    const outer = p.radius ?? 10;
    const innerRatio = p.innerRadius ?? 0.5;
    const inner = outer * Math.max(0.001, Math.min(1, innerRatio));
    const h = p.height ?? 10;
    const startAngle = Math.PI / 2 - Math.PI / 10;
    const n = sides * 2;

    const numVerts = n + 2;
    const verts: number[][] = new Array(numVerts);
    verts[0] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = startAngle + (2 * Math.PI * i) / n;
      verts[i + 1] = [r * Math.cos(a), r * Math.sin(a), 0];
    }
    const apex = n + 1;
    verts[apex] = [0, 0, h];
    const vertProps = buildVertPropsWhite(verts);

    const triVerts = new Uint32Array(n * 2 * 3);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const v1 = i + 1;
      const v2 = ((i + 1) % n) + 1;
      triVerts[t++] = 0; triVerts[t++] = v2; triVerts[t++] = v1;
    }
    for (let i = 0; i < n; i++) {
      const v1 = i + 1;
      const v2 = ((i + 1) % n) + 1;
      triVerts[t++] = v1; triVerts[t++] = v2; triVerts[t++] = apex;
    }
    return { manifold: buildGeneratedSolid(wasm, { numProp: 6, vertProperties: vertProps, triVerts }, 'star') };
  },
});
