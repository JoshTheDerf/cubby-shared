/**
 * The shared CubbyCAD node evaluator: turns a node tree into one triangle mesh
 * with the same geometry CubbyCAD's SceneBuilder renders for it.
 *
 * Semantics mirrored from CubbyCAD (`scene/builder/manifoldComposition.ts`,
 * `geometry/GeometryFactory.ts`, `geometry/CSGProcessor.ts`):
 *
 *  - A primitive's shape builds in the CAD frame (Z-up) and is rotated −90°
 *    about X into the render frame (Y-up); `mesh` geometry is already in the
 *    render frame. Every vertex carries RGB (numProp 6): the geometry's own
 *    colour when it has one (numProp-6 builders, a coloured baked mesh whose
 *    source colours are in use), else the node's `material.color` (default
 *    `#cccccc`), converted sRGB → linear like `new THREE.Color(hex)`.
 *  - A manifold group unions its contributing children in order (hidden,
 *    skeleton, sculpt and reference-image children don't contribute), then
 *    subtracts its holes, each hole expanded by `expandManifoldSlightly` —
 *    exactly `runCsgBatch`, the program CubbyCAD's manifold worker runs. Each
 *    child enters with its own transform; the group's own transform is applied
 *    by its parent (or at the root, if asked).
 *  - A group with no additions is empty.
 *
 * What it doesn't do (CubbyCAD-only): SDF / loft / hull / skin groups, the
 * modifier stack, sculpt, script (`user`) parts, sketches, text, imports,
 * part references. `cadSupport` reports them; the evaluator skips such a
 * subtree with an issue — except `mesh` geometry (a baked subtree), which
 * always builds. `cad_to_slicer` bakes every unsupported subtree to a `mesh`
 * node on the CubbyCAD side first, so a transferred tree always evaluates.
 */

import type { CadGroupNode, CadNode, CadPrimitiveNode } from './types';
import { isCadGroup, isCadPrimitive } from './types';
import type { ManifoldWasm } from './wasm';
import type { MeshBuffers } from './schema';
import type { MeshGeometry } from './geometry';
import { getSharedShape } from './shapes';
import { runCsgBatch, type CsgInput } from './manifold/csgBatchCore';
import { MANIFOLD_NUM_PROP } from './manifold/manifoldMesh';
import {
  isGeometryContributingChild, isReferenceImageNode, isSdfSculptNode, isVirtualNode,
  sculptRoleOf, usesSourceColors,
} from './nodes';
import {
  RENDER_TO_ZUP, determinant, multiplyMatrices, transformPositions, transformToMatrix, type Mat4,
} from './matrix';

export interface EvalMesh {
  /** xyz per vertex — render frame (Y-up) unless `opts.frame === 'zup'`. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Linear RGB per vertex in [0, 1]: each part's colour (what a multicolor
   *  group renders). Present when the root is a `multicolor` group or when
   *  `opts.colors` is set. */
  colors?: Float32Array;
  /** Per-triangle source: `tri[i]` indexes `nodes` (the id of the primitive /
   *  mesh node the triangle came from). Present when `opts.trackSource`. */
  source?: { tri: Uint32Array; nodes: string[] };
}

export type EvalIssueReason =
  | 'sdf-group' | 'loft-group' | 'hull-group' | 'skin-group' | 'modifiers'
  | 'unknown-shape' | 'script-part' | 'sculpt' | 'build-failed' | 'csg-failed'
  | 'root-subtract' | 'hidden';

export interface EvalIssue {
  nodeId: string;
  reason: EvalIssueReason | string;
  message: string;
}

export interface EvalResult {
  mesh: EvalMesh | null;
  issues: EvalIssue[];
}

export interface EvalOptions {
  /** Apply the root node's own transform. Default false: the caller's object
   *  transform (a slicer object's TRS) takes its place. */
  includeRootTransform?: boolean;
  /** Output frame. Default 'render' (Y-up, CubbyCAD); 'zup' applies
   *  `RENDER_TO_ZUP` once at the end. */
  frame?: 'render' | 'zup';
  /** Always return per-vertex `colors` (not only for multicolor roots). */
  colors?: boolean;
  /** Return per-triangle `source`. Adds a property channel to the booleans,
   *  so the triangulation can differ slightly from CubbyCAD's where parts meet. */
  trackSource?: boolean;
}

interface MeshData { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number }

interface EvalCtx {
  wasm: ManifoldWasm;
  issues: EvalIssue[];
  numProp: number;
  track: boolean;
  sources: string[];
}

const DEFAULT_NODE_COLOR = '#cccccc';

// ── colour ────────────────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** A CSS hex colour as linear RGB — what `new THREE.Color(hex)` yields under
 *  three's default colour management. Unparseable → `#cccccc`. */
export function hexToLinearRgb(hex: string | undefined): [number, number, number] {
  let h = (hex ?? DEFAULT_NODE_COLOR).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return hexToLinearRgb(DEFAULT_NODE_COLOR);
  const n = parseInt(h, 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

// ── support analysis ─────────────────────────────────────────────────────────

const GROUP_MODE_REASON: Record<string, EvalIssueReason> = {
  sdf: 'sdf-group', loft: 'loft-group', hull: 'hull-group', skin: 'skin-group',
};

function nodeLabel(n: CadNode): string {
  return n.name ? `"${n.name}"` : n.id;
}

/** Why the shared code can't build `node` itself (ignoring its children), or null. */
function ownIssue(node: CadNode): EvalIssue | null {
  if (Array.isArray(node.modifiers) && node.modifiers.length > 0) {
    return { nodeId: node.id, reason: 'modifiers', message: `${nodeLabel(node)} has a modifier stack.` };
  }
  if (isCadGroup(node)) {
    const mode = node.csgMode ?? 'manifold';
    if (mode !== 'manifold') {
      return {
        nodeId: node.id,
        reason: GROUP_MODE_REASON[mode] ?? 'unknown-shape',
        message: `${nodeLabel(node)} is a${mode === 'sdf' ? 'n' : ''} ${mode} group.`,
      };
    }
    // Sculpt LAYERS fold into their group's result (the manifold-sculpt join),
    // so a group carrying one is CubbyCAD-only as a whole.
    if (node.children.some((c) => !c.hidden && sculptRoleOf(c) === 'layer')) {
      return { nodeId: node.id, reason: 'sculpt', message: `${nodeLabel(node)} carries sculpt layers.` };
    }
    return null;
  }
  if (isCadPrimitive(node)) {
    const type = node.geometry.type;
    if (getSharedShape(type)) return null;
    if (type === 'user') {
      return { nodeId: node.id, reason: 'script-part', message: `${nodeLabel(node)} is a script part.` };
    }
    if (type === 'sdfSculpt') {
      return { nodeId: node.id, reason: 'sculpt', message: `${nodeLabel(node)} is a sculpt.` };
    }
    return { nodeId: node.id, reason: 'unknown-shape', message: `${nodeLabel(node)} is a ${type} part.` };
  }
  return { nodeId: node.id, reason: 'unknown-shape', message: `${nodeLabel(node)} is a ${node.type} node.` };
}

/** Nodes that never produce geometry (and so need no support). */
function isInert(node: CadNode): boolean {
  return isVirtualNode(node) || isReferenceImageNode(node);
}

function collectIssues(node: CadNode, out: EvalIssue[]): void {
  if (node.hidden || isInert(node)) return;
  const own = ownIssue(node);
  if (own) { out.push(own); return; }
  if (isCadGroup(node)) {
    for (const c of node.children) {
      // A sculpt layer's issue was raised on the group (ownIssue).
      if (sculptRoleOf(c) === 'layer') continue;
      collectIssues(c, out);
    }
  }
}

/**
 * Which parts of a tree the shared code can edit and evaluate. Each issue
 * names the ROOT of a maximal unsupported subtree (its descendants aren't
 * reported separately), so baking every `issue.nodeId` to a `mesh` node makes
 * the whole tree evaluable. Hidden subtrees, skeletons and reference images
 * contribute nothing and are never reported.
 */
export function cadSupport(node: CadNode): { editable: boolean; issues: EvalIssue[] } {
  const issues: EvalIssue[] = [];
  collectIssues(node, issues);
  return { editable: issues.length === 0, issues };
}

// ── build ────────────────────────────────────────────────────────────────────

/** Pack render-frame positions (+ optional colours) as MeshData. */
function packMesh(
  ctx: EvalCtx,
  positions: ArrayLike<number>,
  stride: number,
  vertCount: number,
  triVerts: Uint32Array,
  vertexColor: (i: number) => [number, number, number] | null,
  fallback: [number, number, number],
  sourceIndex: number,
): MeshData {
  const np = ctx.numProp;
  const vp = new Float32Array(vertCount * np);
  for (let i = 0; i < vertCount; i++) {
    const o = i * np, pi = i * stride;
    vp[o] = positions[pi];
    vp[o + 1] = positions[pi + 1];
    vp[o + 2] = positions[pi + 2];
    const c = vertexColor(i) ?? fallback;
    vp[o + 3] = c[0];
    vp[o + 4] = c[1];
    vp[o + 5] = c[2];
    if (np > 6) vp[o + 6] = sourceIndex;
  }
  return { vertProperties: vp, triVerts, numProp: np };
}

function buildPrimitive(ctx: EvalCtx, node: CadPrimitiveNode): MeshData | null {
  const def = getSharedShape(node.geometry.type)!;
  const fallback = hexToLinearRgb(node.material?.color);
  const sourceIndex = ctx.sources.length;
  let built;
  try {
    built = def.build(node.geometry as never, { wasm: ctx.wasm });
  } catch (err) {
    ctx.issues.push({ nodeId: node.id, reason: 'build-failed', message: `${nodeLabel(node)} failed to build: ${String((err as Error)?.message ?? err)}` });
    return null;
  }
  if (!built) {
    ctx.issues.push({ nodeId: node.id, reason: 'build-failed', message: `${nodeLabel(node)} produced no geometry.` });
    return null;
  }
  let data: MeshData;
  if ('mesh' in built) {
    const m: MeshBuffers = built.mesh;
    const n = m.positions.length / 3;
    const tri = m.indices ? new Uint32Array(m.indices) : Uint32Array.from({ length: n }, (_, i) => i);
    const cols = m.colors && usesSourceColors(node) ? m.colors : null;
    data = packMesh(ctx, m.positions, 3, n, tri,
      cols ? (i) => [cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]] : () => null,
      fallback, sourceIndex);
  } else {
    // Single CAD → render conversion seam (GeometryFactory.manifoldToGeometry).
    const rotated = built.manifold.rotate([-90, 0, 0]);
    try {
      const mesh = rotated.getMesh();
      const np: number = mesh.numProp ?? 3;
      const vp: Float32Array = mesh.vertProperties;
      const n = vp.length / np;
      data = packMesh(ctx, vp, np, n, new Uint32Array(mesh.triVerts),
        np >= 6 ? (i) => [vp[i * np + 3], vp[i * np + 4], vp[i * np + 5]] : () => null,
        fallback, sourceIndex);
    } finally {
      try { rotated.delete?.(); } catch { /* noop */ }
      try { built.manifold.delete?.(); } catch { /* noop */ }
    }
  }
  if (!data.triVerts.length) {
    ctx.issues.push({ nodeId: node.id, reason: 'build-failed', message: `${nodeLabel(node)} produced no triangles.` });
    return null;
  }
  ctx.sources.push(node.id);
  return data;
}

function buildGroup(ctx: EvalCtx, node: CadGroupNode): MeshData | null {
  const inputs: CsgInput[] = [];
  const additionIndices: number[] = [];
  const subtractionIndices: number[] = [];
  const adds: CadNode[] = [];
  const subs: CadNode[] = [];
  for (const child of node.children) {
    // Sculpt PARTS are union operands in CubbyCAD, but the shared code can't
    // build them: `buildNode` reports them.
    if (!isGeometryContributingChild(child) && !(isSdfSculptNode(child) && !child.hidden && sculptRoleOf(child) === 'part')) continue;
    if ((child.contribution ?? 'add') === 'add') adds.push(child);
    else subs.push(child);
  }
  if (adds.length === 0) return null;
  const enqueue = (child: CadNode, target: number[]) => {
    const data = buildNode(ctx, child);
    if (!data) return;
    target.push(inputs.length);
    inputs.push({ kind: 'mesh', ...data, transform: transformToMatrix(child.transform) });
  };
  for (const c of adds) enqueue(c, additionIndices);
  for (const c of subs) enqueue(c, subtractionIndices);
  if (additionIndices.length === 0) return null;
  const out = runCsgBatch(
    { Mesh: ctx.wasm.Mesh, Manifold: ctx.wasm.Manifold, cache: new Map() },
    { inputs, additionIndices, subtractionIndices, expandSubtractions: true, retainHandles: [] },
  );
  if (out.failed || !out.vertProperties || !out.triVerts) {
    if (out.failed) {
      ctx.issues.push({ nodeId: node.id, reason: 'csg-failed', message: `${nodeLabel(node)}: the boolean produced a non-manifold solid.` });
    }
    return null;
  }
  return { vertProperties: out.vertProperties, triVerts: out.triVerts, numProp: out.numProp };
}

/** A node's un-transformed base mesh (render frame), or null. */
function buildNode(ctx: EvalCtx, node: CadNode): MeshData | null {
  if (node.hidden || isInert(node)) return null;
  const own = ownIssue(node);
  if (own && !(isCadPrimitive(node) && node.geometry.type === 'mesh' && own.reason === 'modifiers')) {
    ctx.issues.push(own);
    return null;
  }
  if (own) {
    // A baked mesh with a (CubbyCAD) modifier stack still builds — without it.
    ctx.issues.push(own);
  }
  if (isCadGroup(node)) return buildGroup(ctx, node);
  return buildPrimitive(ctx, node as CadPrimitiveNode);
}

/**
 * Evaluate a node (usually a top-level scene node) to one mesh.
 *
 * `wasm` is an initialised Manifold module (`const wasm = await Module();
 * wasm.setup()`). Nothing is cached — callers cache by `hashCadNode`.
 */
export function evaluateCadNode(wasm: ManifoldWasm, node: CadNode, opts: EvalOptions = {}): EvalResult {
  const ctx: EvalCtx = {
    wasm,
    issues: [],
    numProp: opts.trackSource ? MANIFOLD_NUM_PROP + 1 : MANIFOLD_NUM_PROP,
    track: !!opts.trackSource,
    sources: [],
  };
  if (node.hidden) {
    return { mesh: null, issues: [{ nodeId: node.id, reason: 'hidden', message: `${nodeLabel(node)} is hidden.` }] };
  }
  if ((node.contribution ?? 'add') === 'subtract') {
    // A hole outside any group renders as a ghost in CubbyCAD — no solid.
    return { mesh: null, issues: [{ nodeId: node.id, reason: 'root-subtract', message: `${nodeLabel(node)} is a hole with nothing to cut.` }] };
  }
  const data = buildNode(ctx, node);
  if (!data) return { mesh: null, issues: ctx.issues };

  const { vertProperties: vp, triVerts, numProp: np } = data;
  const n = vp.length / np;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = vp[i * np];
    positions[i * 3 + 1] = vp[i * np + 1];
    positions[i * 3 + 2] = vp[i * np + 2];
  }
  let m: Mat4 | null = null;
  if (opts.includeRootTransform && node.transform) m = transformToMatrix(node.transform);
  if (opts.frame === 'zup') m = m ? multiplyMatrices(RENDER_TO_ZUP, m) : RENDER_TO_ZUP.slice();
  const indices = new Uint32Array(triVerts);
  if (m) {
    transformPositions(positions, m);
    if (determinant(m) < 0) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
      }
    }
  }
  const mesh: EvalMesh = { positions, indices };
  if (opts.colors || (isCadGroup(node) && node.multicolor)) {
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = vp[i * np + 3];
      colors[i * 3 + 1] = vp[i * np + 4];
      colors[i * 3 + 2] = vp[i * np + 5];
    }
    mesh.colors = colors;
  }
  if (ctx.track) {
    const tri = new Uint32Array(indices.length / 3);
    for (let t = 0; t < tri.length; t++) {
      tri[t] = Math.round(vp[indices[t * 3] * np + 6]);
    }
    mesh.source = { tri, nodes: ctx.sources };
  }
  return { mesh, issues: ctx.issues };
}

// ── hashing ──────────────────────────────────────────────────────────────────

/** Fields that never change a node's geometry. */
const HASH_SKIP = new Set(['name', 'locked', 'cubbyOriginal']);

function stableStringify(v: unknown, top: boolean, skipTransform: boolean): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x, false, false)).join(',')}]`;
  const o = v as Record<string, unknown>;
  // Baked inline mesh: key on the content id, not the base64 blob.
  if (o.type === 'mesh' && typeof o.id === 'string' && o.data && typeof o.data === 'object') {
    return `{"mesh":${JSON.stringify(o.id)}}`;
  }
  const keys = Object.keys(o).filter((k) => o[k] !== undefined && !HASH_SKIP.has(k) && !(top && skipTransform && k === 'transform')).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k], false, false)}`).join(',')}}`;
}

/**
 * Stable content hash of everything that affects `evaluateCadNode(node)`'s
 * output (key order, names, lock state and `cubbyOriginal` payloads don't
 * count). The root transform is left out unless `includeRootTransform`,
 * matching the evaluator's default.
 */
export function hashCadNode(node: CadNode, opts: { includeRootTransform?: boolean } = {}): string {
  const s = stableStringify(node, true, !opts.includeRootTransform);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193);
    h2 ^= c; h2 = Math.imul(h2, 0x5bd1e995); h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** The inline mesh geometry of a node, if it is a baked `mesh` primitive. */
export function meshGeometryOf(node: CadNode): MeshGeometry | null {
  return isCadPrimitive(node) && node.geometry.type === 'mesh' ? node.geometry as unknown as MeshGeometry : null;
}
