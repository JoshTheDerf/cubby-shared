import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldWasm } from './wasm';
import { getManifoldWasm } from './test/wasm';
import { meshStats } from './test/meshStats';
import {
  evaluateCadNode, cadSupport, hashCadNode, hexToLinearRgb, encodeMeshBuffers, computeFlatNormals,
  type CadNode, type CadGroupNode, type CadPrimitiveNode,
} from './index';

let wasm: ManifoldWasm;
beforeAll(async () => { wasm = await getManifoldWasm(); });

const box = (id: string, over: Partial<CadPrimitiveNode> = {}, params: Record<string, unknown> = {}): CadPrimitiveNode => ({
  id, type: 'primitive', geometry: { type: 'box', params: { width: 20, height: 20, depth: 20, ...params } }, ...over,
});
const cyl = (id: string, over: Partial<CadPrimitiveNode> = {}, params: Record<string, unknown> = {}): CadPrimitiveNode => ({
  id, type: 'primitive', geometry: { type: 'cylinder', params: { radius: 5, height: 40, radialSegments: 32, ...params } }, ...over,
});
const group = (id: string, children: CadNode[], over: Partial<CadGroupNode> = {}): CadGroupNode => ({ id, type: 'group', children, ...over });

describe('evaluateCadNode', () => {
  it('builds a primitive in the render frame, resting on y = 0', () => {
    const r = evaluateCadNode(wasm, box('b', {}, { width: 10, height: 20, depth: 30 }));
    expect(r.issues).toEqual([]);
    const s = meshStats(r.mesh!);
    expect(s.volume).toBeCloseTo(6000, 3);
    expect(s.min).toEqual([-5, 0, -15]);
    expect(s.max).toEqual([5, 20, 15]);
  });

  it('converts to Z-up and applies the root transform only when asked', () => {
    const node = box('b', { transform: { position: [100, 0, 0] } }, { width: 10, height: 20, depth: 30 });
    const plain = meshStats(evaluateCadNode(wasm, node, { frame: 'zup' }).mesh!);
    expect(plain.min).toEqual([-5, -15, 0]);
    expect(plain.max).toEqual([5, 15, 20]);
    const moved = meshStats(evaluateCadNode(wasm, node, { includeRootTransform: true }).mesh!);
    expect(moved.min[0]).toBeCloseTo(95);
  });

  it('keeps the winding outward under a mirroring root transform', () => {
    const node = box('b', { transform: { scale: [-1, 1, 1] } });
    const s = meshStats(evaluateCadNode(wasm, node, { includeRootTransform: true }).mesh!);
    expect(s.volume).toBeCloseTo(8000, 3);
  });

  it('cuts holes in a manifold group', () => {
    const g = group('g', [box('b'), cyl('h', { contribution: 'subtract', transform: { position: [0, -10, 0] } })]);
    const r = evaluateCadNode(wasm, g);
    expect(r.issues).toEqual([]);
    const s = meshStats(r.mesh!);
    // 32-gon of radius 5 through a 20 mm box.
    const hole = 0.5 * 32 * 25 * Math.sin((2 * Math.PI) / 32) * 20;
    expect(s.volume).toBeCloseTo(8000 - hole, 1);
  });

  it('skips hidden children and root-level holes', () => {
    const g = group('g', [box('b'), cyl('h', { contribution: 'subtract', hidden: true })]);
    expect(meshStats(evaluateCadNode(wasm, g).mesh!).volume).toBeCloseTo(8000, 3);
    const hole = evaluateCadNode(wasm, cyl('h', { contribution: 'subtract' }));
    expect(hole.mesh).toBeNull();
    expect(hole.issues[0].reason).toBe('root-subtract');
    expect(evaluateCadNode(wasm, box('x', { hidden: true })).mesh).toBeNull();
  });

  it('composes nested groups with rotated and scaled children', () => {
    const inner = group('inner', [box('b1', { transform: { scale: [2, 1, 1] } }, { width: 10, height: 10, depth: 10 })], {
      transform: { position: [0, 0, 50], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
    });
    const outer = group('outer', [box('b0', {}, { width: 10, height: 10, depth: 10 }), inner]);
    const s = meshStats(evaluateCadNode(wasm, outer).mesh!);
    expect(s.volume).toBeCloseTo(1000 + 2000, 2);
    // Inner box: 20 wide on X, rotated 90° about Y → 20 deep on Z around z = 50.
    expect(s.max[2]).toBeCloseTo(60, 4);
    expect(s.min[2]).toBeCloseTo(-5, 4);
  });

  it('returns per-vertex colours for a multicolor group and tracks sources', () => {
    const g = group('g', [
      box('red', { material: { color: '#ff0000' } }, { width: 10, height: 10, depth: 10 }),
      box('blue', { material: { color: '#0000ff' }, transform: { position: [20, 0, 0] } }, { width: 10, height: 10, depth: 10 }),
    ], { multicolor: true });
    const r = evaluateCadNode(wasm, g, { trackSource: true });
    const m = r.mesh!;
    expect(m.colors).toBeDefined();
    const seen = new Set<string>();
    for (let i = 0; i < m.colors!.length; i += 3) seen.add(`${m.colors![i]},${m.colors![i + 1]},${m.colors![i + 2]}`);
    expect(seen).toEqual(new Set(['1,0,0', '0,0,1']));
    expect(m.source!.nodes).toEqual(['red', 'blue']);
    // Every triangle left of x = 10 came from the red box.
    for (let t = 0; t < m.source!.tri.length; t++) {
      const x = m.positions[m.indices[t * 3] * 3];
      expect(m.source!.nodes[m.source!.tri[t]]).toBe(x < 10 ? 'red' : 'blue');
    }
    // Not multicolor, not asked → no colours.
    expect(evaluateCadNode(wasm, { ...g, multicolor: false }).mesh!.colors).toBeUndefined();
  });

  it('builds baked mesh nodes and skips what it cannot build', () => {
    const tri = evaluateCadNode(wasm, box('b', {}, { width: 10, height: 10, depth: 10 }), { colors: true }).mesh!;
    const baked: CadPrimitiveNode = {
      id: 'm', type: 'primitive',
      geometry: encodeMeshBuffers({ positions: tri.positions, normals: computeFlatNormals(tri.positions, tri.indices), indices: tri.indices }) as never,
    };
    const g = group('g', [
      baked,
      { id: 'sdf', type: 'group', csgMode: 'sdf', children: [box('s')] } as CadGroupNode,
      { id: 'u', type: 'primitive', geometry: { type: 'user', shapeId: 'x', params: {} } } as CadPrimitiveNode,
      box('mod', { modifiers: [{ kind: 'mirror' }] }),
    ]);
    const r = evaluateCadNode(wasm, g);
    expect(meshStats(r.mesh!).volume).toBeCloseTo(1000, 2);
    expect(r.issues.map((i) => [i.nodeId, i.reason])).toEqual([
      ['sdf', 'sdf-group'], ['u', 'script-part'], ['mod', 'modifiers'],
    ]);
  });

  it('parses colours like three (sRGB → linear)', () => {
    expect(hexToLinearRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinearRgb('#cccccc')[0]).toBeCloseTo(0.6038, 3);
    expect(hexToLinearRgb('nope')).toEqual(hexToLinearRgb('#cccccc'));
  });
});

describe('cadSupport', () => {
  it('reports the roots of unsupported subtrees', () => {
    const tree = group('root', [
      box('ok'),
      group('sdf', [box('a'), { id: 'deep', type: 'primitive', geometry: { type: 'text', params: {} } } as CadPrimitiveNode], { csgMode: 'sdf' }),
      group('fine', [box('c'), { id: 'img', type: 'primitive', geometry: { type: 'referenceImage', params: {} } } as CadPrimitiveNode]),
      { id: 'hiddenText', type: 'primitive', hidden: true, geometry: { type: 'text', params: {} } } as CadPrimitiveNode,
      group('layered', [box('d'), { id: 'layer', type: 'primitive', geometry: { type: 'sdfSculpt', params: { role: 'layer' } } } as CadPrimitiveNode]),
    ]);
    const s = cadSupport(tree);
    expect(s.editable).toBe(false);
    expect(s.issues.map((i) => [i.nodeId, i.reason])).toEqual([['sdf', 'sdf-group'], ['layered', 'sculpt']]);
    expect(cadSupport(group('g', [box('a'), cyl('b', { contribution: 'subtract' })])).editable).toBe(true);
  });
});

describe('hashCadNode', () => {
  it('is stable across key order, names and root placement, and sees geometry edits', () => {
    const a = box('b', { name: 'A', transform: { position: [1, 2, 3] }, material: { color: '#ff0000' } });
    const b: CadPrimitiveNode = { material: { color: '#ff0000' }, geometry: { params: { depth: 20, height: 20, width: 20 }, type: 'box' }, type: 'primitive', id: 'b', name: 'B' };
    expect(hashCadNode(a)).toBe(hashCadNode(b));
    expect(hashCadNode(a, { includeRootTransform: true })).not.toBe(hashCadNode(b, { includeRootTransform: true }));
    expect(hashCadNode(box('b', {}, { width: 21 }))).not.toBe(hashCadNode(box('b')));
    const g1 = group('g', [box('x', { transform: { position: [0, 0, 0] } })]);
    const g2 = group('g', [box('x', { transform: { position: [1, 0, 0] } })]);
    expect(hashCadNode(g1)).not.toBe(hashCadNode(g2));
  });
});
