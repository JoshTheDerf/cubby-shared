/** Default node colours — moved from CubbyCAD `constants/geometryColors.ts`. */

/**
 * Curated default fills for each built-in geometry type. Distinct enough that
 * a panel of mixed shapes reads at a glance, muted enough to keep the look
 * uniform across the scene. Imported meshes get a hash-derived color so two
 * instances of the same asset share a tint while different assets diverge.
 */
export const TYPE_COLORS: Readonly<Record<string, string>> = {
  box: '#5b8def',
  sphere: '#ef6c6c',
  cylinder: '#f0a04b',
  fillet: '#e0934a',
  cone: '#e8b54a',
  halfSphere: '#d97c7c',
  halfCylinder: '#d99257',
  polygon: '#7eb069',
  pyramid: '#a85d8d',
  wedge: '#5fa8a8',
  roof: '#6b9eb8',
  torus: '#c879b8',
  tube: '#b07ed1',
  paraboloid: '#5cc4a8',
  icosahedron: '#7a8cc0',
  star: '#e8c454',
  extrudeStar: '#d9a93c',
  heart: '#e96b8a',
  ring: '#c5a046',
  text: '#8a8a8a',
  diamond: '#9ec6ea',
  sketchExtrude: '#7aa9c9',
  sketchSweep: '#6f9fc4',
  sketchRevolve: '#8aae9c',
};

export const FALLBACK_COLOR = '#888888';

/** Geometry fields the default colour reads (structural, so CubbyCAD's own
 *  geometry union satisfies it). */
export interface ColorKeyedGeometry {
  type: string;
  assetId?: string;
  partModelId?: string;
}

export function defaultColorForGeometry(params: ColorKeyedGeometry): string {
  if (params.type === 'imported') return hashColor(params.assetId ?? '');
  // Part instances (and voxel parts) carry baked per-vertex colour, so this is
  // just the palette/icon fallback tint — hash it so two instances of the same
  // part share a colour while different parts diverge.
  if (params.type === 'part-ref') return hashColor(params.partModelId ?? '');
  return TYPE_COLORS[params.type] ?? FALLBACK_COLOR;
}

/**
 * Deterministic HSL color from a string seed. Saturation/lightness are pinned
 * to a midtone band so imports stay visually consistent with the curated
 * built-in palette; only hue varies.
 */
export function hashColor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return hslToHex(hue, 55, 62);
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = lN - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
