/**
 * Node classification rules shared by CubbyCAD's scene builder and the shared
 * evaluator (moved from CubbyCAD `scene/builder/geomMath.ts`). Typed
 * structurally so CubbyCAD's own `Node` union passes straight in.
 */

import { defaultColorForGeometry } from './colors';

/** The node fields these rules read. */
export interface NodeLike {
  id: string;
  type: string;
  hidden?: boolean;
  material?: { color?: string };
  geometry?: { type: string; params?: unknown; assetId?: string; partModelId?: string };
}

function geometryType(node: NodeLike): string | undefined {
  return node.type === 'primitive' ? node.geometry?.type : undefined;
}

/** True for primitive nodes whose geometry is a reference-image plane
 *  (render-only overlays that never enter CSG, STL or the slicer). */
export function isReferenceImageNode(node: NodeLike): boolean {
  return geometryType(node) === 'referenceImage';
}

/** Virtual nodes (skeletons) carry no geometry. */
export function isVirtualNode(node: NodeLike): boolean {
  return node.type === 'skeleton';
}

/** A voxel-sculpt node (part or layer). */
export function isSdfSculptNode(node: NodeLike | null | undefined): boolean {
  return !!node && geometryType(node) === 'sdfSculpt';
}

/** Sculpt role: a PART owns its field; a LAYER is a delta applied on top. */
export function sculptRoleOf(node: NodeLike): 'part' | 'layer' | null {
  if (!isSdfSculptNode(node)) return null;
  const p = (node.geometry?.params ?? {}) as { role?: string; background?: number };
  if (p.role === 'part' || p.role === 'layer') return p.role;
  return typeof p.background === 'number' && Number.isFinite(p.background) ? 'part' : 'layer';
}

/**
 * True when `child` contributes geometry to a parent group's composition —
 * i.e. it should participate in the CSG/SDF walk. The exclusions, in one place
 * so every composition path agrees on "what counts as a contributing child":
 *   - hidden nodes (hiding must also stop a node punching/adding to its parent),
 *   - virtual nodes (skeletons — no geometry),
 *   - sculpt-layer nodes (applied as post-ops, not as a boolean operand),
 *   - reference images (render-only overlays).
 * A reference image never has a usable manifold, so excluding it here is also
 * the correct behaviour for the SDF paths.
 */
export function isGeometryContributingChild(child: NodeLike): boolean {
  if (child.hidden) return false;
  if (isVirtualNode(child)) return false;
  if (isSdfSculptNode(child)) return false;
  if (isReferenceImageNode(child)) return false;
  return true;
}

/** Primitive geometry that can carry an INTRINSIC per-vertex colour attribute:
 *  an imported colour mesh, a baked inline mesh (what a voxel part freezes to),
 *  and a placed normal part (whose bake merges every source mesh's colour).
 *  These are the nodes whose `material.color` acts as an OVERRIDE rather than
 *  as the colour itself. */
const SOURCE_COLOR_GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  'imported', 'mesh', 'part-ref',
]);

/** True when this node's geometry may carry its own colours — i.e. when
 *  `material.color` is an override of something rather than the whole story. */
export function canUseSourceColors(node: NodeLike): boolean {
  const t = geometryType(node);
  return t !== undefined && SOURCE_COLOR_GEOMETRY_TYPES.has(t);
}

/**
 * Whether the node renders the colours baked into its geometry (a placed
 * part's, an import's, a voxel part's) rather than its flat `material.color`.
 *
 * The instance inherits its source's colours the same way it inherits its
 * shape, and `material.color` is the per-instance override: setting one
 * flattens the whole instance to it; clearing it returns to the source.
 * Honoured on BOTH the render path (no `vertexColors`) and the CSG ingest
 * path (the flat colour is baked as the fallback, replacing the source's).
 *
 * LEGACY: node creation used to stamp every instance with a deterministic
 * placeholder tint (`defaultColorForGeometry`) that the renderer then ignored,
 * so documents authored before this rule carry a colour nobody chose. A colour
 * that is EXACTLY that stamp is therefore not treated as an override — old
 * scenes keep rendering their source colours, and no saved data is rewritten.
 */
export function usesSourceColors(node: NodeLike): boolean {
  if (!canUseSourceColors(node)) return true;
  const color = node.material?.color;
  if (color === undefined) return true;
  return color === defaultColorForGeometry(node.geometry!);
}
