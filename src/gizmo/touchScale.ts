/**
 * Global handle-size multiplier read by the 3D gizmos and the sketch scene to
 * make on-screen handles bigger on touch devices. The default 1.0 matches the
 * original desktop sizing; the App layer flips this to a larger value when
 * `useViewport().isMobile` is true.
 *
 * This is a plain module-level variable rather than a Pinia store / reactive
 * ref on purpose — it's read inside per-frame render callbacks (EditGizmo
 * update, SketchScene.updateZoomScales) where Vue reactivity machinery would
 * add overhead and a dependency cycle.
 */

let _touchScale = 1;
const listeners = new Set<(scale: number) => void>();

export function getTouchScale(): number {
  return _touchScale;
}

export function setTouchScale(scale: number): void {
  if (scale === _touchScale) return;
  _touchScale = scale;
  for (const fn of listeners) fn(scale);
}

/** Subscribe to touchScale changes. Returns an unsubscribe function. */
export function onTouchScaleChange(fn: (scale: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
