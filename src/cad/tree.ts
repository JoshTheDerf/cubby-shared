/**
 * Pure node-tree operations shared by CubbyCAD and Cubby Slicer — moved from
 * CubbyCAD `scene/NodeTreeUtils.ts`, `core/history/operations/GroupNodesOperation.ts`
 * / `UngroupNodeOperation.ts` and the node-creation paths, which now call these.
 *
 * Everything is typed structurally over {@link TreeNode} so CubbyCAD's own
 * `Node` union (and a slicer's `CadNode`) flows through unchanged. A "root" is
 * anything with `children` (a `.cubby` scene, or `{ children: nodes }`).
 *
 * Mutation: functions named `*InPlace` mutate the tree they're given (the
 * CubbyCAD history operations apply them to the live scene); everything else
 * returns new nodes and leaves its input alone (`groupNodes`, `ungroupNode`,
 * `setContribution`, `createPrimitiveNode`).
 */

import type { CadGroupNode, CadNode, CadPrimitiveNode, CadTransform } from './types';
import { getSharedShape } from './shapes';
import { defaultColorForGeometry } from './colors';
import { decomposeMatrix, multiplyMatrices, transformToMatrix, identityMatrix, type Mat4 } from './matrix';

/** The node fields tree operations read. */
export interface TreeNode {
  id: string;
  type: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  transform?: CadTransform;
  material?: { color?: string };
  children?: unknown;
}

export interface TreeRoot<N extends TreeNode = TreeNode> {
  children: N[];
}

/** A group node (`type: 'group'` with a `children` array). */
export function isTreeGroup<N extends TreeNode>(n: N): n is N & { children: N[] } {
  return n.type === 'group' && Array.isArray(n.children);
}

function kids<N extends TreeNode>(n: N): N[] | null {
  return isTreeGroup(n) ? (n.children as N[]) : null;
}

function asRoot<N extends TreeNode>(root: TreeRoot<N> | N[]): TreeRoot<N> {
  return Array.isArray(root) ? { children: root } : root;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── ids & names ──────────────────────────────────────────────────────────────

/** A fresh node id: a UUID v4 (CubbyCAD's `generateUUID`). */
export function makeNodeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Blender-style "Cube.005" → { base: "Cube", index: 5 }. The suffix must be
 * 3+ digits so legitimate dotted names like "v1.2" aren't mis-split.
 */
export function splitNumberedSuffix(name: string): { base: string; index: number | null } {
  const m = /^(.*)\.(\d{3,})$/.exec(name);
  if (!m) return { base: name, index: null };
  return { base: m[1], index: parseInt(m[2], 10) };
}

/** Every node name in use, skipping `ignoreIds`. */
export function collectUsedNames<N extends TreeNode>(root: TreeRoot<N> | N[], ignoreIds: Set<string> = new Set()): Set<string> {
  const used = new Set<string>();
  forEachNode(root, (n) => {
    if (ignoreIds.has(n.id)) return;
    const name = (n.name ?? '').trim();
    if (name) used.add(name);
  });
  return used;
}

/**
 * Return `desired` if no node uses it, otherwise the next `${base}.NNN`
 * (NNN = 3-digit zero-padded count) that's free. Strips any existing `.NNN`
 * suffix from `desired` so re-saving "Cube.001" against an existing
 * "Cube.001" yields "Cube.002", not "Cube.001.001".
 *
 * `options.used` lets the caller supply a pre-built used-names set when
 * uniquifying many names in a row (each newly-assigned name must be added to
 * the set so the next call sees it).
 */
export function uniqueNodeName<N extends TreeNode>(
  root: TreeRoot<N> | N[],
  desired: string,
  options: { ignoreIds?: Set<string>; used?: Set<string> } = {},
): string {
  const used = options.used ?? collectUsedNames(root, options.ignoreIds ?? new Set());
  if (!used.has(desired)) return desired;
  const { base } = splitNumberedSuffix(desired);
  let i = 1;
  let candidate = `${base}.${String(i).padStart(3, '0')}`;
  while (used.has(candidate)) {
    i++;
    candidate = `${base}.${String(i).padStart(3, '0')}`;
  }
  return candidate;
}

/**
 * Rename every named node of a (not-yet-inserted) subtree so none collides
 * with `root` or with each other. Mutates `subtree` in place.
 */
export function uniquifySubtreeNames<N extends TreeNode>(root: TreeRoot<N> | N[], subtree: N): void {
  const subtreeIds = new Set<string>([subtree.id, ...getDescendantIds(subtree)]);
  const used = collectUsedNames(root, subtreeIds);
  walk(subtree, (node) => {
    const current = (node.name ?? '').trim();
    if (!current) return;
    const next = uniqueNodeName(root, current, { used });
    node.name = next;
    used.add(next);
  });
}

/** Give every node of a subtree a fresh id. Mutates; returns the input. */
export function reassignIds<N extends TreeNode>(node: N): N {
  node.id = makeNodeId();
  const c = kids(node);
  if (c) for (const child of c) reassignIds(child);
  return node;
}

/** Node ids that appear more than once. Empty ⇒ ids are unique. */
export function findDuplicateNodeIds<N extends TreeNode>(root: TreeRoot<N> | N[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  forEachNode(root, (n) => {
    if (seen.has(n.id)) dups.add(n.id);
    else seen.add(n.id);
  });
  return [...dups];
}

// ── walking & lookup ─────────────────────────────────────────────────────────

function walk<N extends TreeNode>(node: N, cb: (n: N) => void): void {
  cb(node);
  const c = kids(node);
  if (c) for (const child of c) walk(child, cb);
}

/** Visit every node, depth-first, parents before children. */
export function forEachNode<N extends TreeNode>(root: TreeRoot<N> | N[], cb: (n: N) => void): void {
  for (const child of asRoot(root).children) walk(child, cb);
}

/** id → node, for O(1) lookups. */
export function buildNodeIndex<N extends TreeNode>(root: TreeRoot<N> | N[]): Map<string, N> {
  const index = new Map<string, N>();
  forEachNode(root, (n) => index.set(n.id, n));
  return index;
}

/** A node by id. */
export function findNodeById<N extends TreeNode>(root: TreeRoot<N> | N[], id: string): N | undefined {
  const r = findNode(root, id);
  return r?.node;
}

/** A node by id with its parent group (null at the root) and index there. */
export function findNode<N extends TreeNode>(
  root: TreeRoot<N> | N[],
  id: string,
): { node: N; parent: (N & { children: N[] }) | null; index: number } | null {
  const search = (list: N[], parent: (N & { children: N[] }) | null): { node: N; parent: (N & { children: N[] }) | null; index: number } | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { node: list[i], parent, index: i };
    }
    for (const n of list) {
      if (isTreeGroup(n)) {
        const r = search(n.children, n);
        if (r) return r;
      }
    }
    return null;
  };
  return search(asRoot(root).children, null);
}

/** Ids from the root down to `targetId` (inclusive), or null. */
export function findPathToNode<N extends TreeNode>(root: TreeRoot<N> | N[], targetId: string): string[] | null {
  const path: string[] = [];
  const inSubtree = (node: N): boolean => {
    path.push(node.id);
    if (node.id === targetId) return true;
    const c = kids(node);
    if (c) for (const child of c) if (inSubtree(child)) return true;
    path.pop();
    return false;
  };
  for (const child of asRoot(root).children) if (inSubtree(child)) return path;
  return null;
}

/** The children array holding a parent's children (`null` ⇒ the root's). */
export function childrenOf<N extends TreeNode>(root: TreeRoot<N> | N[], parentId: string | null): N[] | null {
  const r = asRoot(root);
  if (parentId === null) return r.children;
  const parent = findNodeById(r, parentId);
  if (!parent || !isTreeGroup(parent)) return null;
  return parent.children;
}

/** Ids of every descendant (not the node itself). */
export function getDescendantIds<N extends TreeNode>(node: N): string[] {
  const result: string[] = [];
  const c = kids(node);
  if (c) {
    for (const child of c) {
      result.push(child.id);
      result.push(...getDescendantIds(child));
    }
  }
  return result;
}

/**
 * Effective hidden + locked sets (a hidden / locked group hides / locks its
 * whole subtree) in a single walk.
 */
export function collectEffectiveFlags<N extends TreeNode>(root: TreeRoot<N> | N[]): { hidden: Set<string>; locked: Set<string> } {
  const hidden = new Set<string>();
  const locked = new Set<string>();
  const visit = (n: N, ancHidden: boolean, ancLocked: boolean): void => {
    const h = ancHidden || n.hidden === true;
    const l = ancLocked || n.locked === true;
    if (h) hidden.add(n.id);
    if (l) locked.add(n.id);
    const c = kids(n);
    if (c) for (const child of c) visit(child, h, l);
  };
  for (const c of asRoot(root).children) visit(c, false, false);
  return { hidden, locked };
}

// ── transforms through the tree ──────────────────────────────────────────────

/** World matrix of a node: every ancestor's transform times its own. */
export function computeNodeWorldMatrix<N extends TreeNode>(root: TreeRoot<N> | N[], nodeId: string): Mat4 | null {
  const r = asRoot(root);
  const path = findPathToNode(r, nodeId);
  if (!path) return null;
  let world = identityMatrix();
  for (const id of path) {
    const node = findNodeById(r, id);
    if (node?.transform) world = multiplyMatrices(world, transformToMatrix(node.transform));
  }
  return world;
}

/** Combined transform of a node's ancestors (its own excluded), or null when
 *  it has none. */
export function computeAncestorMatrix<N extends TreeNode>(root: TreeRoot<N> | N[], nodeId: string): Mat4 | null {
  const r = asRoot(root);
  const path = findPathToNode(r, nodeId);
  if (!path || path.length <= 1) return null;
  let combined = identityMatrix();
  let has = false;
  for (let i = 0; i < path.length - 1; i++) {
    const a = findNodeById(r, path[i]);
    if (a?.transform) {
      combined = multiplyMatrices(combined, transformToMatrix(a.transform));
      has = true;
    }
  }
  return has ? combined : null;
}

// ── creation ─────────────────────────────────────────────────────────────────

/** The most frequent `material.color` across nodes and their descendants
 *  (first seen wins ties), lower-cased — a new group's colour. */
export function dominantChildColor<N extends TreeNode>(nodes: N[]): string | undefined {
  const counts = new Map<string, number>();
  const order: string[] = [];
  const visit = (n: N) => {
    const c = n.material?.color;
    if (c) {
      const lc = c.toLowerCase();
      if (!counts.has(lc)) order.push(lc);
      counts.set(lc, (counts.get(lc) ?? 0) + 1);
    }
    const ch = kids(n);
    if (ch) for (const child of ch) visit(child);
  };
  for (const n of nodes) visit(n);
  if (counts.size === 0) return undefined;
  let best = order[0];
  let bestCount = counts.get(best) ?? 0;
  for (const k of order) {
    const v = counts.get(k) ?? 0;
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}

/**
 * A new primitive node for a shared shape, as CubbyCAD creates one: the
 * shape's default params (overridden by `params`), the shape's default colour,
 * the English shape label as its name, identity transform (fields given in
 * `transform` replace the defaults), and `contribution: 'subtract'` for a hole.
 * Unknown shapes throw.
 */
export function createPrimitiveNode(shapeId: string, opts: {
  params?: Record<string, unknown>;
  transform?: CadTransform;
  name?: string;
  color?: string;
  id?: string;
  hole?: boolean;
} = {}): CadPrimitiveNode {
  const def = getSharedShape(shapeId);
  if (!def) throw new Error(`Unknown shape "${shapeId}"`);
  const geometry = { type: shapeId, params: { ...def.defaults, ...(opts.params ?? {}) } };
  return {
    id: opts.id ?? makeNodeId(),
    type: 'primitive',
    name: opts.name ?? def.label,
    geometry,
    material: { color: opts.color ?? defaultColorForGeometry(geometry) },
    transform: {
      position: opts.transform?.position ?? [0, 0, 0],
      rotation: opts.transform?.rotation ?? [0, 0, 0, 1],
      scale: opts.transform?.scale ?? [1, 1, 1],
    },
    ...(opts.hole ? { contribution: 'subtract' as const } : {}),
  };
}

/** A copy of `node` marked as a solid ('add') or a hole ('subtract'). */
export function setContribution<N extends TreeNode>(node: N, contribution: 'add' | 'subtract'): N {
  return { ...node, contribution };
}

// ── group / ungroup ──────────────────────────────────────────────────────────

export interface GroupMember<N extends TreeNode = TreeNode> {
  node: N;
  /** Parent group id, null at the root. */
  parentId: string | null;
  /** Index in that parent's children. */
  index: number;
}

/** Where a new group of `members` lands: the parent of the shallowest member
 *  (first listed wins a tie between different parents at the same depth), at
 *  the slot of the lowest-index member in that parent. */
export function groupPlacement<N extends TreeNode>(
  root: TreeRoot<N> | N[],
  members: GroupMember<N>[],
): { parentId: string | null; index: number } {
  const r = asRoot(root);
  const depthOf = (parentId: string | null): number =>
    parentId === null ? 0 : (findPathToNode(r, parentId)?.length ?? Number.POSITIVE_INFINITY);
  let best = members[0];
  let bestDepth = depthOf(best.parentId);
  for (const m of members.slice(1)) {
    const d = depthOf(m.parentId);
    if (d < bestDepth) { best = m; bestDepth = d; }
  }
  const parentId = best.parentId;
  const index = Math.min(...members.filter((m) => m.parentId === parentId).map((m) => m.index));
  return { parentId, index };
}

/** Transform chain from `hostParentId` (exclusive) down to `parentId`
 *  (inclusive): what a member leaving `parentId` for the host must absorb. */
function chainMatrix<N extends TreeNode>(root: TreeRoot<N>, hostParentId: string | null, parentId: string | null): Mat4 {
  let m = identityMatrix();
  if (parentId === null || parentId === hostParentId) return m;
  const path = findPathToNode(root, parentId) ?? [];
  const start = hostParentId === null ? 0 : path.indexOf(hostParentId) + 1;
  for (const id of path.slice(start)) {
    const g = findNodeById(root, id);
    if (g && isTreeGroup(g)) m = multiplyMatrices(m, transformToMatrix(g.transform));
  }
  return m;
}

/**
 * CubbyCAD's grouping, in place. Pulls each member out of its current location
 * and places them, in order, inside a new group. The group lands at the level
 * of the SHALLOWEST member (see {@link groupPlacement}). Grouping siblings thus
 * keeps them where they were in the tree, and — the new group having an
 * identity transform — where they were in space. A member pulled up from a
 * deeper level gets the transforms of the group(s) it leaves baked into its
 * own, so it doesn't move either (the inverse of {@link ungroupInPlace}).
 * Members are deep-cloned into the group. The group's colour is the members'
 * dominant colour (else `#cccccc`); `fields` add e.g. `csgMode`.
 */
export function groupNodesInPlace<N extends TreeNode>(
  root: TreeRoot<N> | N[],
  members: GroupMember<N>[],
  group: { id: string; name: string; fields?: Record<string, unknown> },
): { group: N & { children: N[] }; parentId: string | null; index: number } {
  const r = asRoot(root);
  // Remove each member from its source container. Sort descending by index
  // *within a parent* so earlier removals don't shift the indices of later
  // siblings — across parents the order doesn't matter.
  const byParent = new Map<string | null, Array<{ index: number; id: string }>>();
  for (const m of members) {
    const list = byParent.get(m.parentId) ?? [];
    list.push({ index: m.index, id: m.node.id });
    byParent.set(m.parentId, list);
  }
  for (const [parentId, list] of byParent) {
    const container = childrenOf(r, parentId);
    if (!container) continue;
    list.sort((a, b) => b.index - a.index);
    for (const { id } of list) {
      const i = container.findIndex((c) => c.id === id);
      if (i >= 0) container.splice(i, 1);
    }
  }
  const { parentId, index } = groupPlacement(r, members);
  const children = members.map((m) => {
    const cloned = deepClone(m.node);
    if (m.parentId !== parentId) {
      const chain = chainMatrix(r, parentId, m.parentId);
      cloned.transform = decomposeMatrix(multiplyMatrices(chain, transformToMatrix(cloned.transform)));
    }
    return cloned;
  });
  const dominant = dominantChildColor(children);
  const created = {
    id: group.id,
    type: 'group',
    name: group.name,
    children,
    material: dominant ? { color: dominant } : { color: '#cccccc' },
    ...(group.fields ?? {}),
  } as unknown as N & { children: N[] };
  const target = childrenOf(r, parentId) ?? r.children;
  if (!Number.isFinite(index) || index < 0 || index > target.length) target.push(created);
  else target.splice(index, 0, created);
  return { group: created, parentId, index };
}

/**
 * Dissolve a group in place: remove it from its parent and splice its children
 * in at the same position, each child's transform pre-multiplied by the
 * group's so it keeps its world placement. Returns the inserted children.
 */
export function ungroupInPlace<N extends TreeNode>(
  root: TreeRoot<N> | N[],
  group: N & { children: N[] },
  parentId: string | null,
  index: number,
): N[] {
  const container = childrenOf(root, parentId);
  if (!container) return [];
  const i = container.findIndex((c) => c.id === group.id);
  if (i < 0) return [];
  container.splice(i, 1);
  const baked = ungroupNode(group);
  container.splice(index, 0, ...baked);
  return baked;
}

/**
 * Group sibling nodes (pure): a new manifold group holding deep clones of
 * `nodes` in order, identity transform, dominant child colour. Use
 * {@link groupNodesInPlace} to group across levels of a live tree.
 */
export function groupNodes<N extends TreeNode>(nodes: N[], opts: {
  id?: string; name?: string; fields?: Record<string, unknown>;
} = {}): CadGroupNode {
  const children = nodes.map((n) => deepClone(n));
  const dominant = dominantChildColor(children);
  return {
    id: opts.id ?? makeNodeId(),
    type: 'group',
    name: opts.name ?? 'Group',
    children: children as unknown as CadNode[],
    material: dominant ? { color: dominant } : { color: '#cccccc' },
    ...(opts.fields ?? {}),
  };
}

/** A group's children (deep clones) with the group's transform baked into
 *  each, so they keep their world placement once the group is gone. */
export function ungroupNode<N extends TreeNode>(group: N & { children: N[] }): N[] {
  const groupMatrix = transformToMatrix(group.transform);
  return group.children.map((child) => {
    const cloned = deepClone(child);
    cloned.transform = decomposeMatrix(multiplyMatrices(groupMatrix, transformToMatrix(cloned.transform)));
    return cloned;
  });
}

// ── immutable edits over a CadNode tree ──────────────────────────────────────

/** Visit every node with its parent group and depth (roots at depth 0). */
export function walkCadNodes(
  root: CadNode | CadNode[],
  fn: (n: CadNode, parent: CadGroupNode | null, depth: number) => void,
): void {
  const visit = (n: CadNode, parent: CadGroupNode | null, depth: number): void => {
    fn(n, parent, depth);
    if (isTreeGroup(n)) for (const c of n.children as CadNode[]) visit(c, n as CadGroupNode, depth + 1);
  };
  for (const n of Array.isArray(root) ? root : [root]) visit(n, null, 0);
}

/** A new tree with node `id` replaced by `fn(node)`; ancestors are copied,
 *  everything else is shared. Throws when `id` isn't in the tree. */
export function updateNode(root: CadNode, id: string, fn: (n: CadNode) => CadNode): CadNode {
  let found = false;
  const rec = (n: CadNode): CadNode => {
    if (n.id === id) { found = true; return fn(n); }
    if (!isTreeGroup(n)) return n;
    const children = n.children as CadNode[];
    let changed = false;
    const next = children.map((c) => {
      if (found) return c;
      const r = rec(c);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? { ...n, children: next } as CadNode : n;
  };
  const out = rec(root);
  if (!found) throw new Error(`No node "${id}"`);
  return out;
}

/** A new tree without node `id` (null when `id` is the root itself). Returns
 *  `root` unchanged when `id` isn't found. */
export function removeNode(root: CadNode, id: string): CadNode | null {
  if (root.id === id) return null;
  const rec = (n: CadNode): CadNode => {
    if (!isTreeGroup(n)) return n;
    const children = n.children as CadNode[];
    const idx = children.findIndex((c) => c.id === id);
    if (idx >= 0) return { ...n, children: children.filter((_, i) => i !== idx) } as CadNode;
    let changed = false;
    const next = children.map((c) => {
      const r = rec(c);
      if (r !== c) changed = true;
      return r;
    });
    return changed ? { ...n, children: next } as CadNode : n;
  };
  return rec(root);
}

/** A deep copy of a node; `freshIds` gives it and its descendants new ids. */
export function cloneCadNode<N extends TreeNode>(n: N, opts: { freshIds?: boolean } = {}): N {
  const copy = deepClone(n);
  return opts.freshIds ? reassignIds(copy) : copy;
}
