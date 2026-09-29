import type { GizmoOptions } from 'three-viewport-gizmo';

/**
 * Colours (and, for Z-up worlds, face labels) for the view-cube gizmo
 * (`three-viewport-gizmo`, type 'cube') per colour mode. The library's
 * defaults are a white cube with near-black labels and yellow edge/corner
 * handles: fine on a light canvas, a glaring white block on a dark one. The
 * options are constructor-only, so hosts rebuild the gizmo when the mode flips
 * (ViewCube.setTheme, ViewportCameraRig).
 */

export interface CubePalette {
  face: string;
  label: string;
  hoverFace: string;
  hoverLabel: string;
  handle: string;
  hoverHandle: string;
  /** The cube body showing between faces (library default is a light grey). */
  body?: string;
}

export interface CubePalettes { light: CubePalette; dark: CubePalette }

/** CubbyCAD's palette (brand blue hover). */
export const CUBBY_CUBE_PALETTES: CubePalettes = {
  light: {
    face: '#ffffff', label: '#222222', hoverFace: '#dbe8ff', hoverLabel: '#0a0a0a',
    handle: '#f2d962', hoverHandle: '#2b7fff',
  },
  dark: {
    face: '#2b3038', label: '#ecebe6', hoverFace: '#4d94ff', hoverLabel: '#ffffff',
    handle: '#5a606a', hoverHandle: '#8fb4d2',
  },
};

/** Named faces, as the library labels them for its own Y-up default. */
export const VIEW_CUBE_FACES = ['right', 'top', 'front', 'left', 'bottom', 'back'] as const;

/** Axis-keyed faces (x = +X face, ny = -Y face, …), used for Z-up worlds. */
export const AXIS_CUBE_FACES = ['x', 'nx', 'y', 'ny', 'z', 'nz'] as const;
export type AxisCubeFace = (typeof AXIS_CUBE_FACES)[number];

/**
 * Face labels for a Z-up bed (Orca / PrusaSlicer): +Z is up, the printer's
 * front is -Y (the "Front" view looks from -Y toward +Y), +X is right. The
 * library's built-in Z-up labels call +Y "Front", so every face is labelled.
 */
export const Z_UP_FACE_LABELS: Record<AxisCubeFace, string> = {
  x: 'Right', nx: 'Left', y: 'Back', ny: 'Front', z: 'Top', nz: 'Bottom',
};

export interface ViewCubeThemeOptions {
  /** Default CUBBY_CUBE_PALETTES. */
  palette?: CubePalettes;
  /** 'z' keys the faces by axis and labels them for the Z-up bed. Default 'y'. */
  up?: 'y' | 'z';
}

export function viewCubeThemeOptions(dark: boolean, opts: ViewCubeThemeOptions = {}): GizmoOptions {
  const palettes = opts.palette ?? CUBBY_CUBE_PALETTES;
  const p = dark ? palettes.dark : palettes.light;
  const face = {
    color: p.face,
    labelColor: p.label,
    hover: { color: p.hoverFace, labelColor: p.hoverLabel },
  };
  const out: GizmoOptions = {
    corners: { color: p.handle, hover: { color: p.hoverHandle } },
    edges: { color: p.handle, hover: { color: p.hoverHandle } },
  };
  if (p.body) out.background = { color: p.body, hover: { color: p.body } };
  if (opts.up === 'z') {
    for (const f of AXIS_CUBE_FACES) out[f] = { label: Z_UP_FACE_LABELS[f], ...face };
  } else {
    for (const f of VIEW_CUBE_FACES) out[f] = { ...face };
  }
  return out;
}
