/**
 * Moving CubbyCAD node trees between the apps (`cad_to_slicer` and back).
 *
 * The payload is plain `.cubby` nodes. Every subtree the shared evaluator
 * can't build (see `cadSupport`) is replaced by a STAND-IN: a `mesh`
 * primitive with the subtree's baked surface (in the subtree root's own frame,
 * so the stand-in keeps the root's transform) and the untouched original under
 * `cubbyOriginal`. The receiver can move, hide, recolour, group and cut with a
 * stand-in like any part; `restoreCadOriginals` swaps the originals back in
 * (carrying those edits) when the tree returns to CubbyCAD.
 */

import type { CadNode, CadPrimitiveNode, CadScene } from './types';
import { isCadGroup } from './types';
import type { MeshBuffers } from './schema';
import { cadSupport, type EvalIssue } from './evaluate';
import { encodeMeshGeometry } from './meshCodec';

export const CAD_TRANSFER_FORMAT = 'cubby-cad-nodes';
/** The key a stand-in keeps its original subtree under. */
export const CUBBY_ORIGINAL_KEY = 'cubbyOriginal';

/** What `cad_export_nodes` returns and `slicer_import_cad` accepts. */
export interface CadTransferPayload {
  format: typeof CAD_TRANSFER_FORMAT;
  version: 1;
  /** Top-level nodes (render frame, Y-up, mm). */
  nodes: CadNode[];
  /** The CAD part's name. */
  name?: string;
  /** Always 'mm' from CubbyCAD (see `CAD_UNIT_TO_MM`). */
  unit?: CadScene['unit'];
}

export interface BakedSubtree {
  nodeId: string;
  name?: string;
  reason: string;
  message: string;
}

/** True for a baked stand-in carrying its original subtree. */
export function isCadStandIn(node: CadNode): boolean {
  return node.type === 'primitive' && !!node[CUBBY_ORIGINAL_KEY] && typeof node[CUBBY_ORIGINAL_KEY] === 'object';
}

/**
 * A stand-in for `original`: a `mesh` primitive with the same id, name,
 * transform, hole / hidden / locked flags and material, the baked `mesh`
 * (render frame, in the original's own frame — its transform NOT applied),
 * and `cubbyOriginal: original`. With `sourceColors` the mesh's vertex colours
 * render (the material colour is dropped, as for a multicolor group).
 */
export function makeCadStandIn(original: CadNode, mesh: MeshBuffers, opts: { sourceColors?: boolean } = {}): CadPrimitiveNode {
  const geometry = encodeMeshGeometry({
    positions: mesh.positions,
    ...(mesh.indices ? { indices: mesh.indices } : {}),
    ...(mesh.normals ? { normals: mesh.normals } : {}),
    ...(opts.sourceColors && mesh.colors ? { colors: mesh.colors } : {}),
    ...(original.name ? { name: original.name } : {}),
  });
  let material = original.material ? { ...original.material } : undefined;
  if (opts.sourceColors && material) {
    delete material.color;
    if (!Object.keys(material).length) material = undefined;
  }
  const standIn: CadPrimitiveNode = {
    id: original.id,
    type: 'primitive',
    ...(original.name !== undefined ? { name: original.name } : {}),
    geometry: geometry as unknown as CadPrimitiveNode['geometry'],
    ...(original.transform ? { transform: original.transform } : {}),
    ...(material ? { material } : {}),
    ...(original.contribution ? { contribution: original.contribution } : {}),
    ...(original.hidden ? { hidden: true } : {}),
    ...(original.locked ? { locked: true } : {}),
    [CUBBY_ORIGINAL_KEY]: JSON.parse(JSON.stringify(original)),
  };
  return standIn;
}

/**
 * Replace every subtree `cadSupport` reports with a stand-in built from
 * `bake(subtreeRoot)` (its render-frame mesh, own transform excluded, or null
 * when it can't be baked). Returns a new tree (unchanged parts shared), the
 * subtrees that were baked and those that couldn't be (left as they were — a
 * receiver skips them). `sourceColors(node)` says whether a stand-in shows its
 * mesh's vertex colours (default: multicolor groups).
 */
export function bakeUnsupportedSubtrees(
  node: CadNode,
  bake: (subtree: CadNode) => MeshBuffers | null,
  opts: { sourceColors?: (subtree: CadNode) => boolean } = {},
): { node: CadNode; baked: BakedSubtree[]; failed: BakedSubtree[] } {
  const { issues } = cadSupport(node);
  const byId = new Map<string, EvalIssue>(issues.map((i) => [i.nodeId, i]));
  const baked: BakedSubtree[] = [];
  const failed: BakedSubtree[] = [];
  const wantsColors = opts.sourceColors ?? ((n: CadNode) => isCadGroup(n) && !!n.multicolor);
  const rec = (n: CadNode): CadNode => {
    const issue = byId.get(n.id);
    if (issue) {
      const entry = { nodeId: n.id, ...(n.name ? { name: n.name } : {}), reason: issue.reason, message: issue.message };
      let mesh: MeshBuffers | null = null;
      try { mesh = bake(n); } catch { mesh = null; }
      if (!mesh || !mesh.positions.length) { failed.push(entry); return n; }
      baked.push(entry);
      return makeCadStandIn(n, mesh, { sourceColors: wantsColors(n) });
    }
    if (!isCadGroup(n)) return n;
    let changed = false;
    const children = n.children.map((c) => {
      const r = rec(c);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? { ...n, children } : n;
  };
  return { node: rec(node), baked, failed };
}

/**
 * Swap every stand-in in a tree back for its original, keeping what the
 * receiver changed on the stand-in: transform, name, hole / hidden / locked
 * and (when set) material colour. Returns a new tree.
 */
export function restoreCadOriginals(node: CadNode): CadNode {
  if (isCadStandIn(node)) {
    const orig = JSON.parse(JSON.stringify(node[CUBBY_ORIGINAL_KEY])) as CadNode;
    const out: CadNode = { ...orig, id: node.id };
    for (const k of ['name', 'transform', 'contribution', 'hidden', 'locked'] as const) {
      if (node[k] !== undefined) (out as Record<string, unknown>)[k] = node[k];
      else delete (out as Record<string, unknown>)[k];
    }
    if (node.material?.color !== undefined) out.material = { ...(orig.material ?? {}), color: node.material.color };
    return out;
  }
  if (!isCadGroup(node)) return node;
  let changed = false;
  const children = node.children.map((c) => {
    const r = restoreCadOriginals(c);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? { ...node, children } : node;
}

/** Validate an incoming payload (either the full object or `{ nodes }`). */
export function parseCadTransfer(v: unknown): CadTransferPayload {
  const o = (v ?? {}) as Partial<CadTransferPayload>;
  if (!Array.isArray(o.nodes)) throw new Error('nodes must be an array of CubbyCAD nodes.');
  for (const n of o.nodes) {
    if (!n || typeof n !== 'object' || typeof (n as CadNode).id !== 'string' || typeof (n as CadNode).type !== 'string') {
      throw new Error('Every node needs a string id and type.');
    }
  }
  if (o.format !== undefined && o.format !== CAD_TRANSFER_FORMAT) throw new Error(`Unknown payload format "${String(o.format)}".`);
  return {
    format: CAD_TRANSFER_FORMAT,
    version: 1,
    nodes: o.nodes,
    ...(typeof o.name === 'string' ? { name: o.name } : {}),
    ...(typeof o.unit === 'string' ? { unit: o.unit } : {}),
  };
}
