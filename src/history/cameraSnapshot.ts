/**
 * `CameraSnapshot` — where the camera was when a history entry was recorded.
 *
 * Stamped onto every op by `HistoryManager` (via the provider the Renderer
 * registers) and persisted in the history envelope, so a build replay can TWEEN
 * the camera along the author's real viewpoints instead of synthesising
 * framing. Pure metadata: undo/redo never read it and never move the camera.
 */
export interface CameraSnapshot {
  /** Camera world position. */
  position: [number, number, number];
  /** Orbit pivot (what the camera looks at). */
  target: [number, number, number];
  projection: 'perspective' | 'orthographic';
  /** Orthographic zoom (1 = unzoomed). Present for both projections so a
   *  projection switch mid-tween has a value to land on. */
  zoom: number;
  /** Perspective vertical FOV in degrees (omitted for orthographic). */
  fov?: number;
}

const EPS = 1e-4;

/** True when two snapshots describe the same view (within float noise). */
export function cameraSnapshotsEqual(a: CameraSnapshot | undefined, b: CameraSnapshot | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.projection !== b.projection) return false;
  if (Math.abs(a.zoom - b.zoom) > EPS) return false;
  if ((a.fov ?? 0) - (b.fov ?? 0) > EPS || (b.fov ?? 0) - (a.fov ?? 0) > EPS) return false;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.position[i] - b.position[i]) > EPS) return false;
    if (Math.abs(a.target[i] - b.target[i]) > EPS) return false;
  }
  return true;
}

/** Validate + normalise a snapshot read from JSON; null when malformed. */
export function parseCameraSnapshot(v: unknown): CameraSnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const vec = (x: unknown): [number, number, number] | null =>
    Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? [x[0], x[1], x[2]] : null;
  const position = vec(o.position);
  const target = vec(o.target);
  if (!position || !target) return null;
  const projection = o.projection === 'perspective' ? 'perspective' : 'orthographic';
  const zoom = typeof o.zoom === 'number' && Number.isFinite(o.zoom) && o.zoom > 0 ? o.zoom : 1;
  const snap: CameraSnapshot = { position, target, projection, zoom };
  if (typeof o.fov === 'number' && Number.isFinite(o.fov)) snap.fov = o.fov;
  return snap;
}
