/**
 * The model-only core of CubbyCAD's `get_node` / `set_node` (moved from
 * CubbyCAD `bridge/nodeSettings.ts`, which keeps the modifier stack, group
 * combine types and history recording on top of this). Both apps' Claude Code
 * bridges validate the same arguments with the same messages and describe a
 * node the same way.
 */

import type { CadNode, CadGroupNode, CadMaterial } from './types';
import { isCadGroup } from './types';
import type { PropertyPanelSchema } from './schema';
import { getSharedShape } from './shapes';
import { cadSupport } from './evaluate';
import { findNodeById, updateNode, type TreeNode } from './tree';

/** Material fields and their value types (all optional; null in set_node clears one). */
export const CAD_MATERIAL_FIELDS: Record<string, { type: 'color' | 'number' | 'boolean'; min?: number; max?: number; help?: string }> = {
  color: { type: 'color', help: 'Surface colour. On placed parts / colour meshes, unset shows the source colours.' },
  opacity: { type: 'number', min: 0, max: 1 },
  roughness: { type: 'number', min: 0, max: 1 },
  metalness: { type: 'number', min: 0, max: 1 },
  emissive: { type: 'color' },
  emissiveIntensity: { type: 'number', min: 0 },
  clearcoat: { type: 'number', min: 0, max: 1 },
  clearcoatRoughness: { type: 'number', min: 0, max: 1 },
  ior: { type: 'number', min: 1, max: 2.333 },
  transmission: { type: 'number', min: 0, max: 1 },
  sheen: { type: 'number', min: 0, max: 1 },
  sheenColor: { type: 'color' },
  sheenRoughness: { type: 'number', min: 0, max: 1 },
  flatShading: { type: 'boolean' },
  showEdges: { type: 'boolean', help: 'Dark edge outline. Unset = default for the node.' },
};

const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function settingNumber(v: unknown, key: string, min?: number, max?: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${key} must be a number.`);
  if (min !== undefined && v < min) throw new Error(`${key} must be at least ${min}.`);
  if (max !== undefined && v > max) throw new Error(`${key} must be at most ${max}.`);
  return v;
}
export function settingBoolean(v: unknown, key: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${key} must be true or false.`);
  return v;
}
export function settingColor(v: unknown, key: string): string {
  if (typeof v !== 'string' || !COLOR_RE.test(v)) throw new Error(`${key} must be a hex colour like "#4a90d9".`);
  return v.toLowerCase();
}

/** A schema as the bridges report it: per key, type / label / default / unit /
 *  min / max / step and enum option values, in schema order. */
export function describeSchema(schema: PropertyPanelSchema | undefined, defaults: Record<string, unknown> | undefined) {
  if (!schema) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of schema.order ?? Object.keys(schema.properties)) {
    const p = schema.properties[key];
    if (!p) continue;
    out[key] = {
      type: p.type, label: (p as { label?: string }).label, default: defaults?.[key] ?? (p as { default?: unknown }).default, unit: (p as { unit?: string }).unit,
      ...('min' in p ? { min: p.min } : {}), ...('max' in p ? { max: p.max } : {}), ...('step' in p ? { step: (p as { step?: number }).step } : {}),
      ...('options' in p ? { options: (p as { options?: Array<{ value: unknown }> }).options?.map((o) => o.value) } : {}),
    };
  }
  return out;
}

/** The fields every node reports (`get_node`'s common part). */
export function describeNodeBase(node: TreeNode & { contribution?: string; material?: object; modifiers?: unknown[] }) {
  return {
    id: node.id, type: node.type, name: node.name ?? null,
    hidden: !!node.hidden, locked: !!node.locked, hole: node.contribution === 'subtract',
    material: { ...(node.material ?? {}) },
    modifiers: (node.modifiers ?? []).map((m) => ({ ...(m as object) })),
  };
}

/**
 * `get_node` for the shared model: the common fields, shape params with their
 * schema (built-in shapes), for groups the combine mode, multicolor and
 * children, and whether the shared code can edit / build it.
 */
export function describeCadNode(node: CadNode): Record<string, unknown> {
  const base = describeNodeBase(node);
  const support = cadSupport(node);
  const supported = { supported: support.editable, ...(support.issues.length ? { issues: support.issues } : {}) };
  if (node.type === 'primitive') {
    const g = (node as { geometry: { type: string; params?: Record<string, unknown> } }).geometry;
    const def = getSharedShape(g.type);
    return {
      ...base,
      geometry: { type: g.type, params: g.params ? { ...g.params } : undefined, schema: describeSchema(def?.schema, def?.defaults) },
      ...supported,
    };
  }
  if (isCadGroup(node)) {
    return {
      ...base,
      group: {
        mode: node.csgMode ?? 'manifold',
        multicolor: !!node.multicolor,
        children: node.children.map((c) => ({ id: c.id, name: c.name ?? null, type: c.type, hole: c.contribution === 'subtract', hidden: !!c.hidden })),
      },
      ...supported,
    };
  }
  return { ...base, ...supported };
}

/** The `set_node` fields shared by both apps. CubbyCAD adds modifiers and its
 *  group combine settings. */
export interface CadNodeSettingsArgs {
  id: string;
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  hole?: boolean;
  color?: string;
  material?: Record<string, unknown>;
  params?: Record<string, unknown>;
  multicolor?: boolean;
  [key: string]: unknown;
}

/** Validated changes for one node (nothing applied yet). */
export interface CadNodeSettingsPlan {
  locked?: boolean;
  hidden?: boolean;
  contribution?: 'add' | 'subtract';
  /** Material fields to set (validated, colours lower-cased). */
  materialPatch: Record<string, unknown>;
  /** Material fields to clear. */
  materialClear: string[];
  /** The whole new params bag (current params merged with the patch). */
  paramsAfter?: Record<string, unknown>;
  multicolor?: boolean;
  /** Trimmed new name ('' = clear). */
  name?: string;
}

/** Keys that only groups accept, in CubbyCAD. */
export const CAD_GROUP_ONLY_SETTINGS = ['groupType', 'blendK', 'blendMode', 'sdfCellSize', 'multicolor', 'loft', 'skin', 'stlFilename'] as const;

/**
 * Validate `args` against `node` and return what would change. Throws with
 * CubbyCAD's messages, in its order: a locked node (unless the same call
 * unlocks it), group-only keys on a non-group, colour, material, params.
 */
export function planCadNodeSettings(
  node: TreeNode & { geometry?: { type: string; params?: Record<string, unknown> } },
  args: CadNodeSettingsArgs,
  opts: { groupOnly?: readonly string[] } = {},
): CadNodeSettingsPlan {
  const has = (k: string) => args[k] !== undefined;
  const touchesOther = Object.keys(args).some((k) => k !== 'id' && k !== 'locked' && args[k] !== undefined);
  if (node.locked && args.locked !== false && touchesOther) {
    throw new Error(`"${node.name ?? node.id}" is locked. Pass locked: false (in the same call) to change it.`);
  }
  if (node.type !== 'group') {
    const bad = (opts.groupOnly ?? CAD_GROUP_ONLY_SETTINGS).filter((k) => has(k));
    if (bad.length) throw new Error(`${bad.join(', ')} only apply to groups; "${node.name ?? node.id}" is a ${node.type}.`);
  }

  const plan: CadNodeSettingsPlan = { materialPatch: {}, materialClear: [] };
  if (has('color')) plan.materialPatch.color = settingColor(args.color, 'color');
  for (const [k, v] of Object.entries(args.material ?? {})) {
    const f = CAD_MATERIAL_FIELDS[k];
    if (!f) throw new Error(`Unknown material field "${k}". Fields: ${Object.keys(CAD_MATERIAL_FIELDS).join(', ')}.`);
    if (v === null) { plan.materialClear.push(k); continue; }
    plan.materialPatch[k] = f.type === 'color' ? settingColor(v, `material.${k}`)
      : f.type === 'boolean' ? settingBoolean(v, `material.${k}`)
        : settingNumber(v, `material.${k}`, f.min, f.max);
  }

  if (has('params')) {
    if (node.type !== 'primitive') throw new Error('params only apply to shapes and script parts.');
    const g = node.geometry ?? { type: '?' };
    if (!g.params || typeof args.params !== 'object' || !args.params) throw new Error(`This ${g.type} node has no parameters.`);
    plan.paramsAfter = { ...g.params, ...args.params };
  }

  if (has('locked')) plan.locked = !!args.locked;
  if (has('hidden')) plan.hidden = settingBoolean(args.hidden, 'hidden');
  if (has('hole')) plan.contribution = settingBoolean(args.hole, 'hole') ? 'subtract' : 'add';
  if (has('multicolor')) plan.multicolor = settingBoolean(args.multicolor, 'multicolor');
  if (has('name')) plan.name = String(args.name).trim();
  return plan;
}

/** A node with a plan applied (a copy; unchanged fields are shared). */
export function applyCadNodeSettingsPlan<N extends CadNode>(node: N, plan: CadNodeSettingsPlan): N {
  const next = { ...node } as N & { material?: CadMaterial; geometry?: { params?: Record<string, unknown> } };
  if (plan.locked !== undefined) { if (plan.locked) next.locked = true; else delete next.locked; }
  if (plan.hidden !== undefined) { if (plan.hidden) next.hidden = true; else delete next.hidden; }
  if (plan.contribution !== undefined) {
    if (plan.contribution === 'subtract') next.contribution = 'subtract'; else delete next.contribution;
  }
  if (Object.keys(plan.materialPatch).length || plan.materialClear.length) {
    const m: CadMaterial = { ...(next.material ?? {}), ...plan.materialPatch };
    for (const k of plan.materialClear) delete m[k];
    next.material = m;
  }
  if (plan.paramsAfter) next.geometry = { ...(next as { geometry: object }).geometry, params: plan.paramsAfter } as never;
  if (plan.multicolor !== undefined && isCadGroup(next)) (next as CadGroupNode).multicolor = plan.multicolor;
  if (plan.name !== undefined) { if (plan.name) next.name = plan.name; else delete next.name; }
  return next;
}

const SHARED_SETTING_KEYS = new Set(['id', 'name', 'hidden', 'locked', 'hole', 'color', 'material', 'params', 'multicolor']);

/**
 * `set_node` for the shared model: validate everything first (nothing changes
 * on an error), then return a NEW root with the node updated. `changed` is
 * false when every value already matched. `notes` is reserved for advisories.
 */
export function applyCadNodeSettings(root: CadNode, args: CadNodeSettingsArgs): { root: CadNode; changed: boolean; notes: string[] } {
  const node = findNodeById([root], args.id);
  if (!node) throw new Error(`No node "${args.id}". Use get_scene.`);
  for (const k of Object.keys(args)) {
    if (args[k] !== undefined && !SHARED_SETTING_KEYS.has(k)) throw new Error(`"${k}" can't be changed here (CubbyCAD only).`);
  }
  const plan = planCadNodeSettings(node as never, args, { groupOnly: ['multicolor'] });
  const next = applyCadNodeSettingsPlan(node, plan);
  const changed = JSON.stringify(next) !== JSON.stringify(node);
  return { root: changed ? updateNode(root, args.id, () => next) : root, changed, notes: [] };
}
