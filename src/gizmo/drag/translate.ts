import * as THREE from 'three';
import {
  intersectRayPlane,
  snap,
  worldDeltaToParentLocal,
} from '../math';
import type { ActiveDrag } from '../internal';
import type { DragContext } from './types';

/**
 * Orthonormal in-plane basis for the plane perpendicular to `up`. For the
 * default world-up this yields u=(0,0,1), v=(1,0,0) — so snapping the (u, v)
 * components reproduces the historical "snap x and z, zero y" behaviour
 * exactly, while an arbitrary `up` (mesh-edit face normal) generalises it.
 */
function planeBasis(up: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  const ref = Math.abs(up.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(ref, up).normalize();
  const v = new THREE.Vector3().crossVectors(up, u).normalize();
  return { u, v };
}

export function applyFloorTranslate(ctx: DragContext, drag: ActiveDrag): void {
  const target = ctx.targetObject;
  const cur = intersectRayPlane(ctx.raycaster.ray, ctx.up, drag.startPointerWorld);
  if (!cur) return;
  const deltaWorld = cur.sub(drag.startPointerWorld);
  const snapStep = drag.shiftKey ? 0 : ctx.snapIncrement;
  const { u, v } = planeBasis(ctx.up);
  const du = snap(deltaWorld.dot(u), snapStep);
  const dv = snap(deltaWorld.dot(v), snapStep);
  deltaWorld.set(0, 0, 0).addScaledVector(u, du).addScaledVector(v, dv);
  target.position.copy(drag.startPosition).add(worldDeltaToParentLocal(deltaWorld, drag.parentInverseWorld));
}

export function applyLiftDrag(ctx: DragContext, drag: ActiveDrag): void {
  const target = ctx.targetObject;
  const up = ctx.up;
  // Drag plane: contains `up`, faces the camera — the generalisation of the
  // old verticalCameraPlaneNormal (camera direction with its up-component
  // removed; camera-right fallback when looking straight along `up`).
  const planeNormal = ctx.camera.getWorldDirection(new THREE.Vector3());
  planeNormal.addScaledVector(up, -planeNormal.dot(up));
  if (planeNormal.lengthSq() < 1e-6) {
    planeNormal.setFromMatrixColumn(ctx.camera.matrixWorld, 0);
    planeNormal.addScaledVector(up, -planeNormal.dot(up));
  }
  planeNormal.normalize();
  const cur = intersectRayPlane(ctx.raycaster.ray, planeNormal, drag.startPointerWorld);
  if (!cur) return;
  const snapStep = drag.shiftKey ? 0 : ctx.snapIncrement;
  const dy = snap(cur.sub(drag.startPointerWorld).dot(up), snapStep);
  const deltaWorld = new THREE.Vector3().addScaledVector(up, dy);
  target.position.copy(drag.startPosition).add(worldDeltaToParentLocal(deltaWorld, drag.parentInverseWorld));
}
