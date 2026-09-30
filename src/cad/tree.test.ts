import { describe, expect, it } from 'vitest';
import {
  createPrimitiveNode, findNode, findPathToNode, groupNodes, groupNodesInPlace, ungroupInPlace, ungroupNode,
  setContribution, uniqueNodeName, uniquifySubtreeNames, makeNodeId, dominantChildColor, collectEffectiveFlags,
  computeNodeWorldMatrix, updateNode, removeNode, cloneCadNode, walkCadNodes, findDuplicateNodeIds,
  transformToMatrix, matrixToTransform, multiplyMatrices, composeMatrix, decomposeMatrix,
  type CadNode, type CadGroupNode, type CadPrimitiveNode, type CadTransform,
} from './index';

const prim = (id: string, t?: CadTransform, color?: string): CadPrimitiveNode => ({
  id, type: 'primitive', name: id, geometry: { type: 'box', params: {} }, ...(t ? { transform: t } : {}), ...(color ? { material: { color } } : {}),
});

function close(a: number[], b: number[], eps = 1e-9) {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));
}

describe('matrix math', () => {
  it('round-trips a TRS transform', () => {
    const q = [0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)];
    const m = composeMatrix([1, 2, 3], q as never, [2, 3, 4]);
    const d = decomposeMatrix(m);
    close(d.position, [1, 2, 3]);
    close(d.rotation, q);
    close(d.scale, [2, 3, 4]);
  });

  it('flips the X scale for a mirror and survives a singular matrix', () => {
    const d = matrixToTransform(transformToMatrix({ scale: [-1, 1, 1] }));
    expect(d.scale[0]).toBeCloseTo(-1);
    expect(matrixToTransform(new Array(16).fill(0)).scale).toEqual([1, 1, 1]);
  });
});

describe('node creation', () => {
  it('creates a primitive like CubbyCAD does', () => {
    const n = createPrimitiveNode('cylinder', { params: { radius: 7 }, hole: true });
    expect(n.type).toBe('primitive');
    expect(n.name).toBe('Cylinder');
    expect(n.geometry).toEqual({ type: 'cylinder', params: { radius: 7, height: 20, radialSegments: 32, bevel: 0, bevelSegments: 1 } });
    expect(n.material).toEqual({ color: '#f0a04b' });
    expect(n.transform).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    expect(n.contribution).toBe('subtract');
    expect(n.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => createPrimitiveNode('nope')).toThrow();
    expect(makeNodeId()).not.toBe(makeNodeId());
  });

  it('marks holes without touching the input', () => {
    const a = prim('a');
    const b = setContribution(a, 'subtract');
    expect(b.contribution).toBe('subtract');
    expect(a.contribution).toBeUndefined();
  });

  it('bumps colliding names Blender-style', () => {
    const root = { children: [prim('Box'), prim('Box.001')] as CadNode[] };
    root.children[0].name = 'Box'; root.children[1].name = 'Box.001';
    expect(uniqueNodeName(root, 'Box')).toBe('Box.002');
    expect(uniqueNodeName(root, 'Sphere')).toBe('Sphere');
    const sub = { ...prim('x'), name: 'Box' };
    uniquifySubtreeNames(root, sub);
    expect(sub.name).toBe('Box.002');
  });
});

describe('lookup', () => {
  const tree: CadNode[] = [prim('a'), { id: 'g', type: 'group', hidden: true, children: [prim('b'), { id: 'h', type: 'group', children: [prim('c')] }] }];
  it('finds nodes with their parent and path', () => {
    const r = findNode(tree, 'c')!;
    expect(r.parent!.id).toBe('h');
    expect(r.index).toBe(0);
    expect(findPathToNode({ children: tree }, 'c')).toEqual(['g', 'h', 'c']);
    expect(findNode(tree, 'zz')).toBeNull();
    expect([...collectEffectiveFlags(tree).hidden].sort()).toEqual(['b', 'c', 'g', 'h']);
    expect(findDuplicateNodeIds(tree)).toEqual([]);
  });
  it('walks with parents and depth', () => {
    const seen: string[] = [];
    walkCadNodes(tree, (n, p, d) => seen.push(`${n.id}:${p?.id ?? '-'}:${d}`));
    expect(seen).toEqual(['a:-:0', 'g:-:0', 'b:g:1', 'h:g:1', 'c:h:2']);
  });
});

describe('group / ungroup', () => {
  it('groups siblings in place at the first member slot with the dominant colour', () => {
    const root = { children: [prim('x'), prim('a', undefined, '#FF0000'), prim('b', undefined, '#ff0000'), prim('c', undefined, '#00ff00')] as CadNode[] };
    const members = [1, 3].map((i) => ({ node: root.children[i], parentId: null, index: i }));
    const { group, index } = groupNodesInPlace(root, members, { id: 'G', name: 'Group' });
    expect(index).toBe(1);
    expect(root.children.map((n) => n.id)).toEqual(['x', 'G', 'b']);
    expect(group.children.map((n) => n.id)).toEqual(['a', 'c']);
    expect(group.material).toEqual({ color: '#ff0000' });
    expect(dominantChildColor([prim('q')])).toBeUndefined();
  });

  it('pulls a deeper member up with its parent transforms baked in', () => {
    const inner: CadGroupNode = { id: 'in', type: 'group', transform: { position: [10, 0, 0] }, children: [prim('deep', { position: [1, 0, 0] })] };
    const root = { children: [prim('top'), inner] as CadNode[] };
    const before = computeNodeWorldMatrix(root, 'deep')!;
    groupNodesInPlace(root, [
      { node: root.children[0], parentId: null, index: 0 },
      { node: inner.children[0], parentId: 'in', index: 0 },
    ], { id: 'G', name: 'G', fields: { multicolor: true } });
    const g = root.children[0] as CadGroupNode;
    expect(g.id).toBe('G');
    expect(g.multicolor).toBe(true);
    expect(g.children[1].transform!.position).toEqual([11, 0, 0]);
    close(computeNodeWorldMatrix(root, 'deep')!, before);
    expect(inner.children).toEqual([]);
  });

  it('ungroups keeping every child where it was', () => {
    const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number];
    const g: CadGroupNode = { id: 'g', type: 'group', transform: { position: [5, 0, 0], rotation: q, scale: [2, 2, 2] }, children: [prim('a', { position: [1, 0, 0] }), prim('b')] };
    const root = { children: [g] as CadNode[] };
    const worldA = computeNodeWorldMatrix(root, 'a')!;
    const out = ungroupInPlace(root, g, null, 0);
    expect(root.children.map((n) => n.id)).toEqual(['a', 'b']);
    expect(out).toHaveLength(2);
    close(transformToMatrix(root.children[0].transform), worldA);
    // Pure form leaves the group alone.
    const again = ungroupNode(g);
    close(transformToMatrix(again[0].transform), multiplyMatrices(transformToMatrix(g.transform), transformToMatrix(g.children[0].transform)));
    expect(g.children[0].transform!.position).toEqual([1, 0, 0]);
  });

  it('groups siblings purely', () => {
    const a = prim('a', undefined, '#123456');
    const g = groupNodes([a, prim('b')], { id: 'G', fields: { csgMode: 'manifold' } });
    expect(g).toMatchObject({ id: 'G', type: 'group', name: 'Group', csgMode: 'manifold', material: { color: '#123456' } });
    expect(g.children[0]).not.toBe(a);
    expect(g.children[0]).toEqual(a);
  });
});

describe('immutable edits', () => {
  const root: CadGroupNode = { id: 'r', type: 'group', children: [prim('a'), { id: 'g', type: 'group', children: [prim('b')] }, prim('c')] };
  it('updates one node and shares the rest', () => {
    const next = updateNode(root, 'b', (n) => ({ ...n, name: 'B!' })) as CadGroupNode;
    expect(next).not.toBe(root);
    expect((next.children[1] as CadGroupNode).children[0].name).toBe('B!');
    expect(next.children[0]).toBe(root.children[0]);
    expect(next.children[2]).toBe(root.children[2]);
    expect(root.children[1]).not.toBe(next.children[1]);
    expect(() => updateNode(root, 'zz', (n) => n)).toThrow();
  });
  it('removes nodes', () => {
    const next = removeNode(root, 'b') as CadGroupNode;
    expect((next.children[1] as CadGroupNode).children).toEqual([]);
    expect(removeNode(root, 'r')).toBeNull();
    expect(removeNode(root, 'zz')).toBe(root);
  });
  it('clones with fresh ids', () => {
    const c = cloneCadNode(root, { freshIds: true }) as CadGroupNode;
    expect(c.id).not.toBe('r');
    expect(c.children[0].id).not.toBe('a');
    expect(c.children[0].name).toBe('a');
    expect(cloneCadNode(root)).toEqual(root);
  });
});
