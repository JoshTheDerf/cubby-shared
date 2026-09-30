import type { SharedShapeDef, ShapeGeometryLike } from '../schema';

/**
 * The shared built-in shapes registry. Each `shapes/<id>.ts` module calls
 * `defineShape({...})` at load; `shapes/index.ts` imports them in CubbyCAD's
 * palette order, which is the registry's iteration order.
 */
const registry = new Map<string, SharedShapeDef>();

/** Register a shared shape and return it (typed for its geometry). */
export function defineShape<G extends ShapeGeometryLike>(
  def: Omit<SharedShapeDef<G>, 'build'> & { build: SharedShapeDef<G>['build'] },
): SharedShapeDef<G> {
  registry.set(def.id, def as unknown as SharedShapeDef);
  return def;
}

export function getSharedShape(id: string): SharedShapeDef | undefined {
  return registry.get(id);
}

/** Every shared shape, palette order first (palette shapes, then the rest). */
export function sharedShapes(): SharedShapeDef[] {
  return Array.from(registry.values());
}

/** The shapes shown in the drag-in palette, in CubbyCAD's order. */
export function paletteSharedShapes(): SharedShapeDef[] {
  return sharedShapes().filter((s) => s.palette);
}

/** True when `type` is a shape the shared code can build. */
export function isSharedShape(type: string): boolean {
  return registry.has(type);
}
