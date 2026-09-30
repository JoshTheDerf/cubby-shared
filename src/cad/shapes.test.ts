import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldWasm } from './wasm';
import { getManifoldWasm } from './test/wasm';
import {
  getSharedShape, paletteSharedShapes, sharedShapes, translateShape, CAD_EN_PARAMS, CAD_EN_PRIMITIVES,
  cadEnglish, decodeMeshBuffers, encodeMeshBuffers, computeFlatNormals,
} from './index';

let wasm: ManifoldWasm;
beforeAll(async () => { wasm = await getManifoldWasm(); });

const PALETTE = [
  'box', 'sphere', 'cylinder', 'fillet', 'capsule', 'cone', 'halfSphere', 'halfCylinder', 'polygon',
  'pyramid', 'wedge', 'roof', 'torus', 'tube', 'paraboloid', 'icosahedron', 'star', 'extrudeStar',
  'heart', 'diamond',
];

describe('shared shapes registry', () => {
  it('lists the palette in CubbyCAD order', () => {
    expect(paletteSharedShapes().map((s) => s.id)).toEqual(PALETTE);
    expect(sharedShapes().map((s) => s.id)).toEqual([...PALETTE, 'ring', 'mesh']);
  });

  it('carries English labels that match the i18n keys', () => {
    for (const s of sharedShapes()) {
      expect(s.labelKey).toMatch(/^primitives\./);
      expect(cadEnglish(s.labelKey)).toBe(s.label);
      for (const p of Object.values(s.schema?.properties ?? {})) {
        expect(p.labelKey).toMatch(/^params\./);
        expect(cadEnglish(p.labelKey!)).toBe(p.label);
      }
    }
    expect(CAD_EN_PRIMITIVES.box).toBe('Box');
    expect(CAD_EN_PARAMS.bevelSegments).toBe('Bevel segments');
  });

  it('translates labels and schema through a translate function', () => {
    const box = getSharedShape('box')!;
    const fr = translateShape(box, (key, en) => (key === 'primitives.box' ? 'Boîte' : key === 'params.width' ? 'Largeur' : en));
    expect(fr.label).toBe('Boîte');
    expect(fr.schema!.properties.width.label).toBe('Largeur');
    expect(fr.schema!.properties.height.label).toBe('Height');
    expect(box.label).toBe('Box'); // original untouched
  });

  it.each(PALETTE)('%s builds a valid solid from its defaults', (id) => {
    const def = getSharedShape(id)!;
    const r = def.build({ type: id, params: { ...def.defaults } } as never, { wasm });
    expect(r && 'manifold' in r).toBe(true);
    const m = (r as { manifold: any }).manifold;
    expect(String(m.status())).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
    // CAD frame: shapes rest on the floor (z = 0) unless they're centred by design.
    const bb = m.boundingBox();
    expect(bb.min[2]).toBeGreaterThan(-1e-6);
    m.delete();
  });

  it('builds a box with the expected volume and a bevelled box smaller', () => {
    const box = getSharedShape('box')!;
    const plain = (box.build({ type: 'box', params: { width: 10, height: 20, depth: 30 } } as never, { wasm }) as { manifold: any }).manifold;
    expect(plain.volume()).toBeCloseTo(6000, 6);
    const bev = (box.build({ type: 'box', params: { width: 10, height: 20, depth: 30, bevel: 2 } } as never, { wasm }) as { manifold: any }).manifold;
    expect(bev.volume()).toBeLessThan(6000);
    expect(bev.volume()).toBeGreaterThan(5000);
    plain.delete(); bev.delete();
  });

  it('builds a ring from its pattern and rejects a degenerate one', () => {
    const ring = getSharedShape('ring')!;
    const pattern: [number, number][] = [[0, 0], [8, 0], [8, 8], [0, 8]];
    const r = ring.build({ type: 'ring', pattern, params: { radius: 10, segments: 32 } } as never, { wasm }) as { manifold: any };
    expect(r.manifold.volume()).toBeGreaterThan(0);
    r.manifold.delete();
    expect(ring.build({ type: 'ring', pattern: [], params: {} } as never, { wasm })).toBeNull();
  });

  it('exposes analytic SDFs that are negative inside and positive outside', () => {
    const sphere = getSharedShape('sphere')!.sdf!({ type: 'sphere', params: { radius: 10 } } as never);
    expect(sphere.sample(0, 10, 0)).toBeCloseTo(-10);
    expect(sphere.sample(0, 25, 0)).toBeCloseTo(5);
  });
});

describe('mesh codec', () => {
  it('round-trips buffers through the inline mesh payload', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const normals = computeFlatNormals(positions, indices);
    expect(Array.from(normals.slice(0, 3))).toEqual([0, 0, 1]);
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const geom = encodeMeshBuffers({ positions, normals, colors, indices }, 'tri');
    expect(geom.type).toBe('mesh');
    expect(geom.id).toMatch(/^m_/);
    expect(geom.data.vertexCount).toBe(3);
    const back = decodeMeshBuffers(geom);
    expect(Array.from(back.positions)).toEqual(Array.from(positions));
    expect(Array.from(back.normals!)).toEqual(Array.from(normals));
    expect(Array.from(back.colors!)).toEqual(Array.from(colors));
    expect(Array.from(back.indices!)).toEqual([0, 1, 2]);
    // The mesh shape decodes the same payload verbatim.
    const built = getSharedShape('mesh')!.build(geom as never, { wasm }) as { mesh: { positions: Float32Array } };
    expect(Array.from(built.mesh.positions)).toEqual(Array.from(positions));
  });

  it('hashes distinct payloads apart', () => {
    const a = encodeMeshBuffers({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array(9) });
    const b = encodeMeshBuffers({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]), normals: new Float32Array(9) });
    expect(a.id).not.toBe(b.id);
  });
});
