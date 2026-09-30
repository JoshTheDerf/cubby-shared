import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyCadNodeSettings, describeCadNode, planCadNodeSettings, applyTransformArgs, quatFromEulerXYZ,
  type CadGroupNode, type CadPrimitiveNode,
} from './index';

const box = (over: Partial<CadPrimitiveNode> = {}): CadPrimitiveNode => ({
  id: 'b', type: 'primitive', name: 'Box', geometry: { type: 'box', params: { width: 20, height: 20, depth: 20 } }, material: { color: '#5b8def' }, ...over,
});
const root = (): CadGroupNode => ({ id: 'g', type: 'group', name: 'G', children: [box(), { id: 'h', type: 'primitive', geometry: { type: 'user', shapeId: 's', params: {} } }] });

describe('node settings', () => {
  it('applies the shared fields immutably', () => {
    const r0 = root();
    const { root: r1, changed } = applyCadNodeSettings(r0, {
      id: 'b', name: '  Lid ', hole: true, hidden: true, color: '#FF0000', material: { roughness: 0.2 }, params: { width: 30 },
    });
    expect(changed).toBe(true);
    const b = (r1 as CadGroupNode).children[0] as CadPrimitiveNode;
    expect(b).toMatchObject({ name: 'Lid', contribution: 'subtract', hidden: true, material: { color: '#ff0000', roughness: 0.2 } });
    expect(b.geometry.params).toEqual({ width: 30, height: 20, depth: 20 });
    expect((r0.children[0] as CadPrimitiveNode).geometry.params!.width).toBe(20);
    const back = applyCadNodeSettings(r1, { id: 'b', hole: false, hidden: false, material: { roughness: null } });
    const b2 = (back.root as CadGroupNode).children[0];
    expect(b2.contribution).toBeUndefined();
    expect(b2.hidden).toBeUndefined();
    expect(b2.material).toEqual({ color: '#ff0000' });
    expect(applyCadNodeSettings(r1, { id: 'b', name: 'Lid' }).changed).toBe(false);
    expect(applyCadNodeSettings(r0, { id: 'g', multicolor: true }).root).toMatchObject({ multicolor: true });
  });

  it('validates with CubbyCAD messages before changing anything', () => {
    const r0 = root();
    expect(() => applyCadNodeSettings(r0, { id: 'zz' })).toThrow('No node "zz". Use get_scene.');
    expect(() => applyCadNodeSettings(r0, { id: 'b', color: 'red' })).toThrow('color must be a hex colour like "#4a90d9".');
    expect(() => applyCadNodeSettings(r0, { id: 'b', material: { shiny: 1 } })).toThrow(/Unknown material field "shiny"/);
    expect(() => applyCadNodeSettings(r0, { id: 'b', material: { opacity: 2 } })).toThrow('material.opacity must be at most 1.');
    expect(() => applyCadNodeSettings(r0, { id: 'b', multicolor: true })).toThrow('multicolor only apply to groups; "Box" is a primitive.');
    expect(() => applyCadNodeSettings(r0, { id: 'g', params: { a: 1 } })).toThrow('params only apply to shapes and script parts.');
    expect(() => applyCadNodeSettings(r0, { id: 'b', modifiers: { add: [] } })).toThrow(/CubbyCAD only/);
    const locked = { ...root(), children: [box({ locked: true })] };
    expect(() => applyCadNodeSettings(locked, { id: 'b', name: 'x' })).toThrow('"Box" is locked. Pass locked: false (in the same call) to change it.');
    expect(applyCadNodeSettings(locked, { id: 'b', locked: false, name: 'x' }).root).toMatchObject({ children: [{ name: 'x' }] });
    expect(planCadNodeSettings(box(), { id: 'b', hole: true }).contribution).toBe('subtract');
  });

  it('describes nodes with schema and support', () => {
    const d = describeCadNode(box()) as any;
    expect(d).toMatchObject({ id: 'b', type: 'primitive', name: 'Box', hole: false, supported: true });
    expect(d.geometry.schema.width).toMatchObject({ type: 'number', label: 'Width', default: 20, unit: 'mm', min: 0.1 });
    const g = describeCadNode(root()) as any;
    expect(g.group).toMatchObject({ mode: 'manifold', multicolor: false });
    expect(g.group.children).toHaveLength(2);
    expect(g.supported).toBe(false);
    expect(g.issues[0]).toMatchObject({ nodeId: 'h', reason: 'script-part' });
  });
});

describe('transform args', () => {
  it('matches three for XYZ Euler rotation', () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 2.2, 'XYZ'));
    expect(quatFromEulerXYZ(0.3, -1.1, 2.2)).toEqual([q.x, q.y, q.z, q.w]);
  });
  it('sets and offsets like CubbyCAD transform_node', () => {
    const t = { position: [1, 2, 3] as [number, number, number], scale: [2, 2, 2] as [number, number, number] };
    expect(applyTransformArgs(t, { position: [5, 5, 5] })).toEqual({ position: [5, 5, 5], rotation: [0, 0, 0, 1], scale: [2, 2, 2] });
    const off = applyTransformArgs(t, { mode: 'offset', position: [1, 1, 1], scale: [0.5, 1, 2], rotationDeg: [0, 90, 0] });
    expect(off.position).toEqual([2, 3, 4]);
    expect(off.scale).toEqual([1, 2, 4]);
    const d = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)).multiply(new THREE.Quaternion(0, 0, 0, 1));
    expect(off.rotation).toEqual([d.x, d.y, d.z, d.w]);
    expect(applyTransformArgs(undefined, { position: [1, 2] })).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  });
});
