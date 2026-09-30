/**
 * Shape-definition types: the property-panel schema (a small JSON-schema
 * flavour), the analytic SDF contract, and the shared shape definition itself.
 * Moved from CubbyCAD `geometry/shapes/types.ts`, which re-exports them.
 *
 * Labels are English. `labelKey` names the CubbyCAD i18n key for the same
 * string (`primitives.box`, `params.width`) so an app with a translation
 * catalogue can localise them; see `translateSchema` / `translateShape`.
 */

import type { ManifoldWasm } from './wasm';

// ─────────────────────────────────────────────────────────────────────────────
// JSON-schema flavor used for property panels
// ─────────────────────────────────────────────────────────────────────────────

export type PropertySchema =
  | NumberPropertySchema
  | IntegerPropertySchema
  | StringPropertySchema
  | BooleanPropertySchema
  | EnumPropertySchema;

export interface BasePropertySchema {
  /** Human-readable label rendered above the input. */
  label: string;
  /** i18n key for `label` (CubbyCAD's catalogue, e.g. `params.width`).
   *  Absent for user-authored schemas, whose labels are literal. */
  labelKey?: string;
  /** Optional units appended to the label (e.g. "mm"). */
  unit?: string;
  /** Hint for advanced/optional fields. Currently unused; reserved. */
  advanced?: boolean;
}

export interface NumberPropertySchema extends BasePropertySchema {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  step?: number;
  /** Slider upper bound when no hard `max` is supplied. */
  sliderMax?: number;
}

export interface IntegerPropertySchema extends BasePropertySchema {
  type: 'integer';
  default: number;
  min?: number;
  max?: number;
  step?: number;
  sliderMax?: number;
}

export interface StringPropertySchema extends BasePropertySchema {
  type: 'string';
  default: string;
}

export interface BooleanPropertySchema extends BasePropertySchema {
  type: 'boolean';
  default: boolean;
}

/** A constrained-choice property. `options` declares the menu items; each
 *  item's `value` is what flows into the script's `params` bag (so an enum
 *  param yields a string at runtime, not the label). */
export interface EnumPropertySchema extends BasePropertySchema {
  type: 'enum';
  default: string;
  options: Array<{ label: string; value: string; labelKey?: string }>;
}

export interface PropertyPanelSchema {
  /** Properties keyed by the GeometryParams field they patch. */
  properties: Record<string, PropertySchema>;
  /** Render order; defaults to Object.keys(properties). */
  order?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytic SDF
// ─────────────────────────────────────────────────────────────────────────────

/** Analytic representation of a shape for the per-group SDF CSG mode.
 *  Lives in the shape's own local frame (Three frame, Y-up, mm — see the
 *  per-shape notes).
 *
 *  - `sample(p)` returns the signed distance from `p` to the shape's
 *    surface in mm (negative inside, positive outside).
 *  - `bounds` is the shape's axis-aligned bounding box in the same
 *    local frame. The group-level rebuild unions transformed bounds
 *    across children to size the extraction lattice.
 *
 *  Shapes whose surface has no clean closed-form distance (diamond,
 *  star, icosahedron, sketch extrusions, imported meshes, user shapes)
 *  simply omit `sdf` and disqualify the group from SDF mode. */
export interface ShapeSdf {
  sample: (x: number, y: number, z: number) => number;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape definition
// ─────────────────────────────────────────────────────────────────────────────

/** Plain triangle buffers (Three render frame, Y-up) — what the `mesh` shape
 *  decodes its inline payload to. */
export interface MeshBuffers {
  /** xyz per vertex. */
  positions: Float32Array;
  /** xyz per vertex (may be absent for meshes that never carried them). */
  normals?: Float32Array;
  /** rgb per vertex in [0, 1], only when the source carried real colour. */
  colors?: Float32Array;
  /** Triangle indices; absent ⇒ non-indexed (every 3 vertices a triangle). */
  indices?: Uint32Array;
}

/** What `build` hands back.
 *   - `manifold`: a Manifold in the CAD frame (Z-up, floor at z = 0). The
 *     evaluator (and CubbyCAD's GeometryFactory) rotate it −90° about X into
 *     the render frame. The caller owns it and must `delete()` it.
 *   - `mesh`: ready triangles already in the render frame (no rotation). */
export type SharedShapeBuildResult =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { manifold: any }
  | { mesh: MeshBuffers };

export interface SharedShapeBuildContext {
  wasm: ManifoldWasm;
}

/** A geometry object: `type` picks the shape. Kept structural (no index
 *  signature) so CubbyCAD's own geometry interfaces satisfy it. */
export interface ShapeGeometryLike {
  type: string;
}

export interface SharedShapeDef<G extends ShapeGeometryLike = ShapeGeometryLike> {
  /** Discriminator value used in the geometry's `type`. */
  id: string;
  /** English label shown in the palette and tree view. */
  label: string;
  /** i18n key for `label` in CubbyCAD's catalogue (`primitives.<id>`). */
  labelKey: string;
  /** Iconify name (Lucide set), e.g. `i-lucide-box`. */
  icon: string;
  /** Whether this shape appears in the drag-in palette. */
  palette: boolean;
  /** Default editable params for a new node (the inner `params` bag). */
  defaults: Record<string, unknown>;
  /** Property-panel schema; absent for shapes with no editable params. */
  schema?: PropertyPanelSchema;
  /** Build the geometry. Returns null on missing/degenerate input. */
  build: (geom: G, ctx: SharedShapeBuildContext) => SharedShapeBuildResult | null;
  /** Optional analytic SDF for the per-group SDF mode (CubbyCAD only). */
  sdf?: (geom: G) => ShapeSdf;
}

/** Translate function: `(key, englishFallback) → label`. Shared UI and the
 *  helpers below call it with CubbyCAD i18n keys. */
export type Translate = (key: string, fallback: string) => string;

/** A copy of `schema` with every `labelKey`-carrying label run through `t`. */
export function translateSchema(schema: PropertyPanelSchema, t: Translate): PropertyPanelSchema {
  const properties: Record<string, PropertySchema> = {};
  for (const [k, p] of Object.entries(schema.properties)) {
    const label = p.labelKey ? t(p.labelKey, p.label) : p.label;
    if (p.type === 'enum') {
      properties[k] = {
        ...p,
        label,
        options: p.options.map((o) => ({ ...o, label: o.labelKey ? t(o.labelKey, o.label) : o.label })),
      };
    } else {
      properties[k] = { ...p, label };
    }
  }
  return schema.order ? { properties, order: [...schema.order] } : { properties };
}

/** A copy of a shape definition with its label and schema localised. */
export function translateShape<G extends ShapeGeometryLike>(def: SharedShapeDef<G>, t: Translate): SharedShapeDef<G> {
  return {
    ...def,
    label: t(def.labelKey, def.label),
    ...(def.schema ? { schema: translateSchema(def.schema, t) } : {}),
  };
}
