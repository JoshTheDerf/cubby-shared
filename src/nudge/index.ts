import * as THREE from 'three';

/**
 * @cubby/shared/nudge — keyboard moves of the selection (CubbyCAD's arrow-key
 * nudges), as app-agnostic pieces:
 *
 * - `nudgeDelta(key, …)`: arrow key → world-space move. Plain arrows slide
 *   the selection across the ground (camera-relative when a camera is given,
 *   along fixed world axes otherwise); Shift+Up/Down moves it vertically when
 *   `shiftVertical` is set (the editor's convention).
 * - `nudgeStep(snapIncrement, …)`: the step, tied to the grid snap.
 * - `NudgeBurst`: seals a burst of nudges as ONE undo step once the keys go
 *   idle (each nudge is a full start → change → end, so finalizing per press
 *   would fragment "nudge 7×" into 7 steps).
 * - `applyWorldTranslation`: write a world-space move into a (parented)
 *   object's local position.
 */

export type NudgeUp = 'y' | 'z';

export interface ArrowAxes {
  horizontalAxis: THREE.Vector3;
  horizontalSign: number;
  verticalAxis: THREE.Vector3;
  verticalSign: number;
}

/** The two ground axes (perpendicular to `up`), in the order [first, second]. */
function groundAxes(up: NudgeUp): [THREE.Vector3, THREE.Vector3] {
  return up === 'z'
    ? [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)]
    : [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
}

/**
 * Resolve which GROUND axis (and sign) each plain arrow key nudges along,
 * given the camera's world-space right / up basis vectors (columns 0 and 1 of
 * its matrixWorld). Pure, so the mapping can be tested without a camera.
 *
 * The model is ground-pan: plain arrows slide the target across the floor so
 * they correspond to screen up/down/left/right, and NEVER move along world up
 * (vertical is Shift+Up/Down, always world up regardless of camera angle).
 *
 * Left/Right follow the ground axis the camera's right vector aligns with most;
 * Up/Down take the OTHER ground axis, signed so Up tracks screen-up's ground
 * projection. Choosing "the other" axis (rather than independently projecting
 * cameraUp, which ties at a corner) keeps the two on DISTINCT axes so an
 * exact-corner view never collapses both onto one ("stuck"). `|| 1` guards the
 * degenerate sign==0 case (edge-on front/side view, where screen-up has no
 * ground projection) so a nudge never resolves to zero movement.
 */
export function resolveArrowAxes(
  cameraRight: THREE.Vector3,
  cameraUp: THREE.Vector3,
  up: NudgeUp = 'y',
): ArrowAxes {
  const [a, b] = groundAxes(up);
  const rightDotA = Math.abs(cameraRight.dot(a));
  const rightDotB = Math.abs(cameraRight.dot(b));
  if (rightDotA >= rightDotB) {
    return {
      horizontalAxis: a,
      horizontalSign: Math.sign(cameraRight.dot(a)) || 1,
      verticalAxis: b,
      verticalSign: Math.sign(cameraUp.dot(b)) || 1,
    };
  }
  return {
    horizontalAxis: b,
    horizontalSign: Math.sign(cameraRight.dot(b)) || 1,
    verticalAxis: a,
    verticalSign: Math.sign(cameraUp.dot(a)) || 1,
  };
}

export interface NudgeDeltaOptions {
  /** Move length in world units. */
  step: number;
  /** World up axis. Default 'y'. */
  up?: NudgeUp;
  /** Map arrows to screen directions (resolveArrowAxes). Without a camera,
   *  Left/Right are ∓X and Up/Down the other ground axis, "away" positive
   *  (+Y for Z-up, -Z for Y-up). */
  camera?: THREE.Camera;
  /** Shift+Up/Down move along world up instead (CubbyCAD). */
  shiftVertical?: boolean;
  shift?: boolean;
}

/** World-space move for an arrow key, or null for any other key. */
export function nudgeDelta(key: string, opts: NudgeDeltaOptions): THREE.Vector3 | null {
  const up = opts.up ?? 'y';
  const step = opts.step;
  const out = new THREE.Vector3();
  const upAxis = up === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  if (opts.shiftVertical && opts.shift && (key === 'ArrowUp' || key === 'ArrowDown')) {
    return out.addScaledVector(upAxis, key === 'ArrowUp' ? step : -step);
  }
  let axes: ArrowAxes;
  if (opts.camera) {
    opts.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(opts.camera.matrixWorld, 0).normalize();
    const camUp = new THREE.Vector3().setFromMatrixColumn(opts.camera.matrixWorld, 1).normalize();
    axes = resolveArrowAxes(right, camUp, up);
  } else {
    const [a, b] = groundAxes(up);
    axes = { horizontalAxis: a, horizontalSign: 1, verticalAxis: b, verticalSign: up === 'z' ? 1 : -1 };
  }
  switch (key) {
    case 'ArrowRight': return out.addScaledVector(axes.horizontalAxis, step * axes.horizontalSign);
    case 'ArrowLeft': return out.addScaledVector(axes.horizontalAxis, -step * axes.horizontalSign);
    case 'ArrowUp': return out.addScaledVector(axes.verticalAxis, step * axes.verticalSign);
    case 'ArrowDown': return out.addScaledVector(axes.verticalAxis, -step * axes.verticalSign);
    default: return null;
  }
}

/**
 * Nudge step for a snap increment: the increment itself while snapping is on,
 * `fallback` when it's off. `fine` (e.g. Shift) divides by 10.
 */
export function nudgeStep(snapIncrement: number, opts: { fallback?: number; fine?: boolean } = {}): number {
  const base = snapIncrement > 0 ? snapIncrement : (opts.fallback ?? 1);
  return opts.fine ? base / 10 : base;
}

/**
 * Translate `object` by a WORLD-space delta, writing the result back into its
 * (parent-)local `position`. `object.position` is expressed in the parent's
 * frame, so adding a world vector to it directly skews the move whenever the
 * parent is rotated or scaled (a group, a mirrored node, …). Converting the
 * target world position back through `parent.worldToLocal` keeps the nudge
 * axis-true in world space regardless of the parent transform.
 */
export function applyWorldTranslation(object: THREE.Object3D, worldDelta: THREE.Vector3): void {
  const parent = object.parent;
  if (parent) {
    const targetWorld = object.getWorldPosition(new THREE.Vector3()).add(worldDelta);
    object.position.copy(parent.worldToLocal(targetWorld));
  } else {
    object.position.add(worldDelta);
  }
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

/** Idle window after the last nudge before the burst is sealed as one undo
 *  step. 700 ms spans key auto-repeat + deliberate taps while staying under
 *  the history coalesce window (1 s), so an unsealed nudge always still merges. */
export const NUDGE_SEAL_MS = 700;

/**
 * Trailing seal for a burst of keyboard nudges: `bump()` on every nudge
 * (re)arms the timer; `seal` runs once the keys have been idle for `ms`
 * (typically the history's `finalizeActiveTransform`). A pointer gesture calls
 * `flush()` to seal a pending burst right away so it starts a fresh step.
 */
export class NudgeBurst {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly seal: () => void, private readonly ms = NUDGE_SEAL_MS) {}

  bump(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.seal(); }, this.ms);
  }

  /** True while a burst is waiting to be sealed. */
  get pending(): boolean { return this.timer !== null; }

  /** Drop a pending seal without running it. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Seal now if a burst is pending. */
  flush(): void {
    if (this.timer === null) return;
    this.cancel();
    this.seal();
  }
}
