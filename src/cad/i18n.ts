/**
 * English copy for the shared CAD modules, keyed exactly like CubbyCAD's i18n
 * catalogue (`primitives.*`, `params.*`). CubbyCAD's `locales/en/primitives.ts`
 * and `params.ts` are these objects, so the two can't drift; an app without a
 * catalogue gets English by passing no translate function.
 */

import type { Translate } from './schema';

/** Shape display names (`primitives.<key>`). */
export const CAD_EN_PRIMITIVES = {
  box: 'Box',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  capsule: 'Capsule',
  torus: 'Torus',
  pyramid: 'Pyramid',
  wedge: 'Wedge',
  diamond: 'Diamond',
  icosahedron: 'Icosahedron',
  paraboloid: 'Paraboloid',
  halfSphere: 'Half sphere',
  halfCylinder: 'Half cylinder',
  ring: 'Ring',
  tube: 'Tube',
  polygon: 'Polygon',
  star: 'Star',
  starFlat: 'Star (flat)',
  heart: 'Heart',
  roof: 'Roof',
  fillet: 'Fillet',
  text: 'Text',
  imported: 'Imported mesh',
  mesh: 'Mesh',
  part: 'Part',
  referenceImage: 'Reference image',
  user: 'User shape',
  sculpt: 'Sculpt',
  sketchExtrude: 'Sketch (extrude)',
  sketchRevolve: 'Sketch (revolve)',
  sketchSweep: 'Sketch (sweep)',
};

/** Geometry parameter labels (`params.<key>`). */
export const CAD_EN_PARAMS = {
  height: 'Height',
  radius: 'Radius',
  segments: 'Segments',
  bevelSegments: 'Bevel segments',
  bevel: 'Bevel',
  depth: 'Depth',
  width: 'Width',
  outerRadius: 'Outer radius',
  sides: 'Sides',
  points: 'Points',
  innerOuterRatio: 'Inner / outer ratio',
  wallThickness: 'Wall thickness',
  tubeSegments: 'Tube segments',
  tubeRadius: 'Tube radius',
  topScale: 'Top scale',
  topRadius: 'Top radius',
  text: 'Text',
  size: 'Size',
  ringSegments: 'Ring segments',
  ringRadius: 'Ring radius',
  opacity: 'Opacity',
  longitudeSegments: 'Longitude segments',
  latitudeSegments: 'Latitude segments',
  font: 'Font',
  doubleSided: 'Double-sided',
  centreGap: 'Centre gap',
  bottomScale: 'Bottom scale',
  bottomRadius: 'Bottom radius',
};

const CATALOGUE: Record<string, Record<string, string>> = {
  primitives: CAD_EN_PRIMITIVES,
  params: CAD_EN_PARAMS,
};

/** English for a `primitives.*` / `params.*` key, or undefined. */
export function cadEnglish(key: string): string | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  return CATALOGUE[key.slice(0, dot)]?.[key.slice(dot + 1)];
}

/** The default translate: always the English fallback. */
export const englishTranslate: Translate = (_key, fallback) => fallback;
