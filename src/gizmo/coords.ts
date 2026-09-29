import * as THREE from 'three';

/**
 * The gizmo's own frame is Three.js's default: X right, Y up, Z back. Every
 * "up" in the layout and drag math means +Y of this frame. A host whose world
 * is Z-up (bed / CAD coordinates) wraps the gizmo in `TransformGizmo` with
 * `up: 'z'`, which runs it in a Y-up view of that world (see transformGizmo.ts).
 */

/** Fresh `Vector3` for the gizmo-frame world up (+Y). Callers may mutate it. */
export function worldUpThree(): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0);
}
