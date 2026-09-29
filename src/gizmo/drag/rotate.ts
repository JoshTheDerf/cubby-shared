import * as THREE from 'three';
import {
  intersectRayPlane,
  signedAngleAroundAxis,
  snap,
  worldDeltaToParentLocal,
} from '../math';
import { ROTATION_SNAP_DEG } from '../../snap';
import type { ActiveDrag } from '../internal';
import type { DragContext } from './types';

export interface RotateDragDebugInfo {
  anchorWorld: THREE.Vector3;
  startWorld: THREE.Vector3;
  currentWorld: THREE.Vector3;
}

export function applyRotateDrag(
  ctx: DragContext,
  drag: ActiveDrag,
  publishDebug: (info: RotateDragDebugInfo) => void,
): void {
  if (drag.role.kind !== 'rotate-trigger') return;
  const target = ctx.targetObject;

  const cur = intersectRayPlane(ctx.raycaster.ray, drag.rotateAxisWorld, drag.rotateOriginWorld);
  if (!cur) return;
  publishDebug({ anchorWorld: drag.rotateOriginWorld, startWorld: drag.startPointerWorld, currentWorld: cur });
  const curAngle = signedAngleAroundAxis(cur, drag.rotateOriginWorld, drag.rotateAxisWorld);

  let delta = curAngle - drag.startRotateAngle;
  const snapAngle = drag.shiftKey || ctx.snapIncrement <= 0 ? 0 : THREE.MathUtils.degToRad(ROTATION_SNAP_DEG);
  delta = snap(delta, snapAngle);
  drag.currentRotateAngle = drag.startRotateAngle + delta;

  const startWorldQuat = new THREE.Quaternion();
  drag.startMatrixWorld.decompose(new THREE.Vector3(), startWorldQuat, new THREE.Vector3());
  const newWorldQuat = new THREE.Quaternion()
    .setFromAxisAngle(drag.rotateAxisWorld, delta)
    .multiply(startWorldQuat);
  const parentWorldQuat = new THREE.Quaternion();
  if (target.parent) {
    target.parent.matrixWorld.decompose(new THREE.Vector3(), parentWorldQuat, new THREE.Vector3());
  }
  target.quaternion.copy(parentWorldQuat.invert().multiply(newWorldQuat));

  target.scale.copy(drag.startScale);
  target.position.copy(drag.startPosition);
  target.updateMatrixWorld(true);

  let newCenterWorld: THREE.Vector3;
  if (ctx.space === 'local') {
    newCenterWorld = ctx.obbBox.getCenter(new THREE.Vector3()).applyMatrix4(target.matrixWorld);
  } else {
    newCenterWorld = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3());
  }
  const correctionWorld = drag.rotateOriginWorld.clone().sub(newCenterWorld);
  target.position.add(worldDeltaToParentLocal(correctionWorld, drag.parentInverseWorld));
}
