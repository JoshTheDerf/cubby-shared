import * as THREE from 'three';

/** Anything `Raycaster.setFromCamera` accepts. Several sessions only hold a
 *  `THREE.Camera`, so the ortho branch is a runtime check, not a type narrow. */
type PickCamera = THREE.Camera;

/**
 * `raycaster.setFromCamera` for PICKING — use this everywhere a pointer/NDC
 * position is turned into a scene ray.
 *
 * Why it exists: for an orthographic camera three puts the ray origin at
 * view-space z = 0 — the plane through the camera's own POSITION — regardless of
 * `near`. (It unprojects NDC z = (near+far)/(near-far), which works out to
 * z_view = 0 for every near/far pair.) That is fine for the textbook ortho
 * camera whose near plane is ~at the camera, but ours deliberately uses a
 * NEGATIVE near (`-20000`, see `core/Scene.ts` and `ViewportCameraRig`) so that
 * geometry BEHIND the camera position still renders — a parallel projection has
 * no reason to clip it, and CAD users expect to keep seeing the model when the
 * orbit pivot ends up inside it.
 *
 * The consequence was that any geometry between the near plane and the camera
 * position plane was visible but NOT pickable: the ray started in the middle of
 * the model. With the pivot at the world origin and a part extending further
 * than the orbit distance, exactly the three axis views that look "into" the
 * part broke — the voxel editor and the SDF sculpt brush only worked from the
 * other three sides.
 *
 * The fix is to start the ray at the camera's actual near plane
 * (z_view = -near), which is where everything the camera can DRAW begins.
 * Perspective cameras are untouched (their origin is already the eye point).
 */
export function setPickRayFromCamera(
  raycaster: THREE.Raycaster,
  ndc: THREE.Vector2,
  camera: PickCamera,
): void {
  raycaster.setFromCamera(ndc, camera);
  const ortho = camera as THREE.OrthographicCamera;
  if (!ortho.isOrthographicCamera) return;
  // origin is at z_view = 0; move it to z_view = -near along the view direction
  // (forward is -Z in view space, so the signed step is exactly `near`).
  raycaster.ray.origin.addScaledVector(raycaster.ray.direction, ortho.near);
}
