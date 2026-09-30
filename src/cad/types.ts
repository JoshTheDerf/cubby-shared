/**
 * CubbyCAD's scene document model — the part both apps read and write.
 *
 * This is the on-disk `.cubby` node format, verbatim. CubbyCAD's own
 * `types/scene.ts` / `types/geometry.ts` are supersets (skeletons, sketches,
 * sculpt, script parts, …); every value typed here is a valid CubbyCAD value,
 * and anything this module does not understand is carried through untouched
 * (`[key: string]: unknown` on nodes / geometry) so a slicer round-trip never
 * drops data it can't edit.
 *
 * Frames: node `transform`s are in the Three.js render frame (Y-up), exactly as
 * CubbyCAD applies them to its Object3Ds. Built-in shape builders produce
 * Manifolds in the CAD frame (Z-up); the evaluator rotates them into the render
 * frame (−90° about X) before applying node transforms, like GeometryFactory.
 * Consumers in a Z-up world (the slicer) apply `RENDER_TO_ZUP` once at the root.
 */

export interface CadTransform {
  position?: [number, number, number];
  /** Quaternion [x, y, z, w]. */
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

export interface CadMaterial {
  color?: string;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  [key: string]: unknown;
}

/** A shape's geometry: `type` picks the shape, `params` its editable values. */
export interface CadGeometry {
  type: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export type CadGroupMode = 'manifold' | 'sdf' | 'loft' | 'hull' | 'skin';

export interface CadBaseNode {
  id: string;
  type: 'primitive' | 'group' | string;
  name?: string;
  /** 'subtract' = a hole. */
  contribution?: 'add' | 'subtract';
  transform?: CadTransform;
  material?: CadMaterial;
  hidden?: boolean;
  locked?: boolean;
  /** CubbyCAD modifier stack (mirror, array, …). Not evaluated by the shared
   *  evaluator — a node with modifiers is reported unsupported. */
  modifiers?: unknown[];
  [key: string]: unknown;
}

export interface CadPrimitiveNode extends CadBaseNode {
  type: 'primitive';
  geometry: CadGeometry;
}

export interface CadGroupNode extends CadBaseNode {
  type: 'group';
  children: CadNode[];
  /** Absent = 'manifold'. Only 'manifold' is evaluated by the shared code. */
  csgMode?: CadGroupMode;
  multicolor?: boolean;
}

export type CadNode = CadPrimitiveNode | CadGroupNode | CadBaseNode;

/** A `.cubby` document (only the fields the shared code touches are typed). */
export interface CadScene {
  version: 1;
  unit: 'mm' | 'cm' | 'in' | 'm';
  children: CadNode[];
  name?: string;
  [key: string]: unknown;
}

export function isCadGroup(n: CadNode): n is CadGroupNode {
  return n.type === 'group' && Array.isArray((n as CadGroupNode).children);
}

export function isCadPrimitive(n: CadNode): n is CadPrimitiveNode {
  return n.type === 'primitive' && !!(n as CadPrimitiveNode).geometry;
}
