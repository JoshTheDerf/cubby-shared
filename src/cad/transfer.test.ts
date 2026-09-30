import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldWasm } from './wasm';
import { getManifoldWasm } from './test/wasm';
import { meshStats } from './test/meshStats';
import {
  bakeUnsupportedSubtrees, restoreCadOriginals, isCadStandIn, parseCadTransfer, evaluateCadNode, cadSupport,
  createPrimitiveNode, hashCadNode, CUBBY_ORIGINAL_KEY, type CadGroupNode, type CadNode,
} from './index';

let wasm: ManifoldWasm;
beforeAll(async () => { wasm = await getManifoldWasm(); });

const sdfGroup = (): CadGroupNode => ({
  id: 'blob', type: 'group', name: 'Blob', csgMode: 'sdf', blendK: 2,
  transform: { position: [40, 0, 5] }, material: { color: '#ff0000' },
  children: [createPrimitiveNode('sphere', { id: 's1', params: { radius: 5 } })],
});

describe('transfer', () => {
  it('bakes unsupported subtrees into stand-ins the evaluator builds, and restores them', () => {
    const tree: CadGroupNode = {
      id: 'root', type: 'group', name: 'Root',
      children: [createPrimitiveNode('box', { id: 'b', params: { width: 30, height: 10, depth: 30 } }), sdfGroup()],
    };
    expect(cadSupport(tree).editable).toBe(false);
    // "CubbyCAD's bake": evaluate a sphere of the same size as the SDF blob.
    const bake = (n: CadNode) => evaluateCadNode(wasm, (n as CadGroupNode).children[0], { colors: true }).mesh;
    const { node, baked, failed } = bakeUnsupportedSubtrees(tree, bake);
    expect(baked).toEqual([{ nodeId: 'blob', name: 'Blob', reason: 'sdf-group', message: expect.any(String) }]);
    expect(failed).toEqual([]);
    const stand = (node as CadGroupNode).children[1];
    expect(isCadStandIn(stand)).toBe(true);
    expect(stand).toMatchObject({ id: 'blob', type: 'primitive', name: 'Blob', transform: { position: [40, 0, 5] }, material: { color: '#ff0000' } });
    expect((stand as { geometry: { type: string } }).geometry.type).toBe('mesh');
    expect(stand[CUBBY_ORIGINAL_KEY]).toEqual(sdfGroup());
    expect((node as CadGroupNode).children[0]).toBe(tree.children[0]);
    expect(cadSupport(node).editable).toBe(true);
    const r = evaluateCadNode(wasm, node);
    expect(r.issues).toEqual([]);
    expect(meshStats(r.mesh!).volume).toBeGreaterThan(9000);

    // The receiver moves and renames the stand-in; the return trip keeps that.
    const edited = { ...node, children: [(node as CadGroupNode).children[0], { ...stand, name: 'Moved', transform: { position: [9, 0, 0] } }] } as CadGroupNode;
    const back = restoreCadOriginals(edited) as CadGroupNode;
    expect(back.children[1]).toEqual({ ...sdfGroup(), name: 'Moved', transform: { position: [9, 0, 0] } });
    expect(hashCadNode(restoreCadOriginals(node))).toBe(hashCadNode(tree));
  });

  it('keeps a subtree it could not bake and reports it', () => {
    const { node, failed } = bakeUnsupportedSubtrees(sdfGroup(), () => null);
    expect(node).toEqual(sdfGroup());
    expect(failed.map((f) => f.nodeId)).toEqual(['blob']);
  });

  it('shows source colours for multicolor stand-ins', () => {
    const g: CadGroupNode = { ...sdfGroup(), multicolor: true };
    const { node } = bakeUnsupportedSubtrees(g, (n) => evaluateCadNode(wasm, (n as CadGroupNode).children[0], { colors: true }).mesh);
    expect(node.material).toBeUndefined();
    expect((node as unknown as { geometry: { data: { color?: string } } }).geometry.data.color).toBeTruthy();
    expect((restoreCadOriginals(node) as CadGroupNode).material).toEqual({ color: '#ff0000' });
  });

  it('parses payloads', () => {
    expect(parseCadTransfer({ nodes: [], name: 'P' })).toEqual({ format: 'cubby-cad-nodes', version: 1, nodes: [], name: 'P' });
    expect(() => parseCadTransfer({})).toThrow();
    expect(() => parseCadTransfer({ nodes: [{}] })).toThrow();
    expect(() => parseCadTransfer({ nodes: [], format: 'x' })).toThrow();
  });
});
