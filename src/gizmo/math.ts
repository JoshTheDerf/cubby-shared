import * as THREE from 'three';
import { worldUpThree } from './coords';

/**
 * gizmo-math
 * ──────────
 * Pure transform-math primitives used by EditGizmo. Each function in this file
 * exists because Three.js's API has at least one footgun in this area, and we
 * want the workaround named, documented, and tested ONCE.
 *
 * Conventions:
 * - World space = scene root frame.
 * - Parent-local = the frame `target.position` lives in (one above target).
 * - "OBB-local" = target's own pre-transform frame; geometry vertices live here.
 * - Y is up. Primitives' local bboxes start at y=0 (see GeometryFactory).
 */

type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

// ───────────────────────────────────────────────────────────────────────────
// Vector / matrix helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Apply the rotation+scale (3×3 upper-left) of a Matrix4 to a Vector3,
 * preserving magnitude.
 *
 * Why this exists: `Vector3.transformDirection(m)` looks like the right call
 * here, but it normalizes the result, clamping every drag delta to magnitude 1.
 * `Vector3.applyMatrix4(m)` includes translation, which is wrong for
 * displacement vectors. This is the correct operation for "I have a delta in
 * world space, give me the same delta in parent-local space".
 */
export function applyDirectionPreserving(v: THREE.Vector3, m: THREE.Matrix4): THREE.Vector3 {
  const x = v.x, y = v.y, z = v.z;
  const e = m.elements;
  v.x = e[0] * x + e[4] * y + e[8] * z;
  v.y = e[1] * x + e[5] * y + e[9] * z;
  v.z = e[2] * x + e[6] * y + e[10] * z;
  return v;
}

/**
 * Convert a world-space displacement vector to the parent-local frame of `target`,
 * preserving magnitude. The result can be added directly to `target.position`.
 *
 * `parentInverseWorld` is `parent.matrixWorld.invert()` (or identity if no parent).
 */
export function worldDeltaToParentLocal(
  worldDelta: THREE.Vector3,
  parentInverseWorld: THREE.Matrix4,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  out.copy(worldDelta);
  return applyDirectionPreserving(out, parentInverseWorld);
}

/**
 * Get a unit-length world direction by mapping a local-frame axis through the
 * rotation+scale of a matrix. Strips uniform/non-uniform scale via normalize.
 *
 * Use when you want "which way does X point in world?", not "how long is the
 * world equivalent of a 1-unit local vector?".
 */
export function worldUnitAxis(
  localAxis: THREE.Vector3,
  worldMatrix: THREE.Matrix4,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  out.copy(localAxis);
  applyDirectionPreserving(out, worldMatrix);
  return out.normalize();
}

// ───────────────────────────────────────────────────────────────────────────
// Box / OBB helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compute a Box3 in `target`'s own local frame, ignoring its world transform.
 * This is the OBB foundation: applying `target.matrixWorld` to this box gives
 * the world-space oriented bounding box.
 *
 * Why not `Box3.setFromObject(target)`? That returns a world-axis-aligned
 * AABB of all descendants, which bloats and detaches from the geometry as
 * soon as the object rotates.
 */
export function localOBBOf(target: THREE.Object3D): THREE.Box3 {
  target.updateMatrixWorld(true);
  const targetWorldInv = new THREE.Matrix4().copy(target.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  const tmpMatrix = new THREE.Matrix4();

  target.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh.isMesh && mesh.geometry)) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const childBox = mesh.geometry.boundingBox;
    if (!childBox) return;
    tmpMatrix.multiplyMatrices(targetWorldInv, mesh.matrixWorld);
    tmpBox.copy(childBox).applyMatrix4(tmpMatrix);
    box.union(tmpBox);
  });

  if (box.isEmpty()) {
    box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  }
  return box;
}

/**
 * Convert a WORLD-space override box into a target's LOCAL frame (Bug 5).
 *
 * Used by EditGizmo's bounds-override path for empty-geometry targets (skeleton
 * stub Groups), where `localOBBOf` returns the degenerate [-0.5,0.5] fallback.
 * Returns null when `worldBox` is null or empty, so the caller can fall back to
 * the geometry box.
 */
export function worldBoxToLocalBox(
  worldBox: THREE.Box3 | null,
  targetWorldMatrix: THREE.Matrix4,
): THREE.Box3 | null {
  if (!worldBox || worldBox.isEmpty()) return null;
  const inv = new THREE.Matrix4().copy(targetWorldMatrix).invert();
  return worldBox.clone().applyMatrix4(inv);
}

/**
 * Pick a point on a Box3 by per-axis sign:
 *   sign = -1 → min on that axis
 *   sign = +1 → max on that axis
 *   sign =  0 → center on that axis
 *
 * Use for handle layout (where to place a corner/edge/face handle) and for
 * computing the anchor (opposite face) during scale drags.
 */
export function boxPoint(
  box: THREE.Box3,
  signs: THREE.Vector3,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const center = box.getCenter(new THREE.Vector3());
  out.set(
    signs.x === 0 ? center.x : signs.x > 0 ? box.max.x : box.min.x,
    signs.y === 0 ? center.y : signs.y > 0 ? box.max.y : box.min.y,
    signs.z === 0 ? center.z : signs.z > 0 ? box.max.z : box.min.z,
  );
  return out;
}

/**
 * Anchor point for a scale drag: the face/edge/corner OPPOSITE the dragged
 * handle. Pulling +X drags the +X face; the −X face is the anchor that should
 * stay fixed in world space.
 *
 * Axes with sign=0 (not being scaled) anchor at the box center, since their
 * extent isn't changing and any choice is valid.
 */
export function boxScaleAnchor(
  box: THREE.Box3,
  scaleSigns: THREE.Vector3,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const center = box.getCenter(new THREE.Vector3());
  out.set(
    scaleSigns.x === 0 ? center.x : scaleSigns.x > 0 ? box.min.x : box.max.x,
    scaleSigns.y === 0 ? center.y : scaleSigns.y > 0 ? box.min.y : box.max.y,
    scaleSigns.z === 0 ? center.z : scaleSigns.z > 0 ? box.min.z : box.max.z,
  );
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Plane / ray helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Intersect a ray with a plane defined by `(normal, throughPoint)`.
 * Returns a fresh Vector3, or null if the ray is parallel to the plane.
 *
 * Why not `THREE.Plane.intersectLine`? Line, not ray; doesn't fail cleanly on
 * parallel; and we don't want to allocate a Plane object per frame.
 */
export function intersectRayPlane(
  ray: THREE.Ray,
  normal: THREE.Vector3,
  throughPoint: THREE.Vector3,
): THREE.Vector3 | null {
  const denom = ray.direction.dot(normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = throughPoint.clone().sub(ray.origin).dot(normal) / denom;
  if (!Number.isFinite(t)) return null;
  return ray.origin.clone().addScaledVector(ray.direction, t);
}

/**
 * Build a plane perpendicular to the camera's view direction, passing through
 * `point`. Used for scale drags where we want the cursor's screen motion to map
 * cleanly to a world-space drag delta regardless of camera angle.
 *
 * Returns the plane's normal (camera-facing); the plane is `(normal, point)`.
 */
export function cameraFacingPlaneNormal(
  camera: Camera,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  camera.getWorldDirection(out);
  return out.negate();
}

/**
 * Build a vertical plane (Y-up) facing the camera through `point`. Used for
 * Y-axis drags (lift handle, top scale handle) where we want cursor screen-Y
 * to map to world-Y movement, while the plane stays vertical so distant
 * cursor positions still resolve to a sane Y delta.
 *
 * Returns the plane's normal (horizontal, pointing toward the camera).
 */
export function verticalCameraPlaneNormal(
  camera: Camera,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  camera.getWorldDirection(out);
  out.y = 0;
  if (out.lengthSq() < 1e-6) {
    // Camera looks straight up/down — fall back to the camera's right axis.
    out.setFromMatrixColumn(camera.matrixWorld, 0);
    out.y = 0;
  }
  return out.normalize();
}

// ───────────────────────────────────────────────────────────────────────────
// Angle helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Signed angle (radians) of `point` projected onto the plane perpendicular to
 * `axisWorld` through `origin`. Used for rotation drags.
 *
 * The "zero" direction is chosen deterministically: world-up if the axis is
 * mostly horizontal, world-X otherwise. Frame-to-frame consistency matters more
 * than absolute orientation.
 */
export function signedAngleAroundAxis(
  point: THREE.Vector3,
  origin: THREE.Vector3,
  axisWorld: THREE.Vector3,
): number {
  const v = point.clone().sub(origin);
  v.sub(axisWorld.clone().multiplyScalar(v.dot(axisWorld)));
  const ref = Math.abs(axisWorld.y) < 0.9
    ? worldUpThree()
    : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(ref, axisWorld).normalize();
  const up = new THREE.Vector3().crossVectors(axisWorld, right).normalize();
  return Math.atan2(v.dot(up), v.dot(right));
}

// ───────────────────────────────────────────────────────────────────────────
// Camera / pixel helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * World units per CSS pixel at a given world-space point. Used to size
 * gizmo handles consistently regardless of zoom or camera type.
 *
 * For perspective: derived from FOV and distance to the point.
 * For orthographic: derived from the frustum height (independent of distance).
 */
export function worldUnitsPerPixel(
  camera: Camera,
  worldPoint: THREE.Vector3,
  viewportHeightPx: number,
): number {
  if (camera instanceof THREE.OrthographicCamera) {
    const frustumHeight = (camera.top - camera.bottom) / camera.zoom;
    return frustumHeight / viewportHeightPx;
  }
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  const dist = camPos.distanceTo(worldPoint);
  const fovRad = (camera.fov * Math.PI) / 180;
  return (2 * Math.tan(fovRad / 2) * dist) / viewportHeightPx;
}

// ───────────────────────────────────────────────────────────────────────────
// Snap helpers
// ───────────────────────────────────────────────────────────────────────────

/** Snap a value to the nearest multiple of `increment` (see @cubby/shared/snap). */
export { snap } from '../snap';
