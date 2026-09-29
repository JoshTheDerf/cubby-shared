import * as THREE from 'three';
import { GIZMO_CONSTANTS as G } from '../constants';
import {
  boxScaleAnchor,
  cameraFacingPlaneNormal,
  intersectRayPlane,
  snap,
  worldDeltaToParentLocal,
  worldUnitAxis,
} from '../math';
import type { ActiveDrag, Axis } from '../internal';
import type { DragContext } from './types';

export function captureScaleAnchor(localBox: THREE.Box3, obbGroupMatrixWorld: THREE.Matrix4, drag: ActiveDrag): void {
  if (drag.role.kind !== 'scale') return;
  if (drag.altKey) {
    localBox.getCenter(drag.anchorLocal);
  } else {
    boxScaleAnchor(localBox, drag.role.scaleSigns, drag.anchorLocal);
  }
  drag.anchorWorld.copy(drag.anchorLocal).applyMatrix4(obbGroupMatrixWorld);
}

export function currentScaleAnchorWorld(
  targetObject: THREE.Object3D,
  space: 'local' | 'world',
  scaleSigns: THREE.Vector3,
  anchorLocal: THREE.Vector3,
  useCenter: boolean,
): THREE.Vector3 {
  if (space === 'local') {
    return anchorLocal.clone().applyMatrix4(targetObject.matrixWorld);
  }
  const newAABB = new THREE.Box3().setFromObject(targetObject);
  if (useCenter) return newAABB.getCenter(new THREE.Vector3());
  return boxScaleAnchor(newAABB, scaleSigns, new THREE.Vector3());
}

export interface ScaleDragDebugInfo {
  anchorWorld: THREE.Vector3;
  startWorld: THREE.Vector3;
  currentWorld: THREE.Vector3;
}

export function applyScaleDrag(
  ctx: DragContext,
  drag: ActiveDrag,
  publishDebug: (info: ScaleDragDebugInfo) => void,
): void {
  if (drag.role.kind !== 'scale') return;
  const target = ctx.targetObject;
  const scaleSigns = drag.role.scaleSigns;

  // Decompose the target's start-of-drag *world* scale. We modify target.scale
  // (which is parent-local), but the cursor delta is in world units — so the
  // factor we compute has to convert world extent → world extent. Using
  // target.scale here under-counts by the parent's world scale and causes the
  // drag to over-shoot whenever the target lives inside a scaled group.
  const startWorldScale = new THREE.Vector3();
  drag.startMatrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), startWorldScale);

  const planeNormal = cameraFacingPlaneNormal(ctx.camera);
  const cur = intersectRayPlane(ctx.raycaster.ray, planeNormal, drag.startPointerWorld);
  if (!cur) return;
  const curForDebug = cur.clone();
  const dragDeltaWorld = cur.sub(drag.startPointerWorld);
  publishDebug({ anchorWorld: drag.anchorWorld, startWorld: drag.startPointerWorld, currentWorld: curForDebug });

  let dirX: THREE.Vector3, dirY: THREE.Vector3, dirZ: THREE.Vector3;
  if (ctx.space === 'local') {
    dirX = worldUnitAxis(new THREE.Vector3(1, 0, 0), drag.startMatrixWorld);
    dirY = worldUnitAxis(new THREE.Vector3(0, 1, 0), drag.startMatrixWorld);
    dirZ = worldUnitAxis(new THREE.Vector3(0, 0, 1), drag.startMatrixWorld);
  } else {
    dirX = new THREE.Vector3(1, 0, 0);
    dirY = new THREE.Vector3(0, 1, 0);
    dirZ = new THREE.Vector3(0, 0, 1);
  }
  const drags = {
    x: dragDeltaWorld.dot(dirX),
    y: dragDeltaWorld.dot(dirY),
    z: dragDeltaWorld.dot(dirZ),
  };

  const obbSize = ctx.obbBox.getSize(new THREE.Vector3());
  const newScale = drag.startScale.clone();
  const snapStep = drag.shiftKey ? 0 : ctx.snapIncrement;
  const factors: number[] = [];

  if (ctx.space === 'local') {
    const setAxis = (ax: Axis, sign: number, drag1d: number) => {
      if (sign === 0) return;
      const localExtent = ax === 'x' ? obbSize.x : ax === 'y' ? obbSize.y : obbSize.z;
      if (localExtent < G.MIN_LOCAL_DIMENSION) return;
      const startScaleVal = drag.startScale[ax];
      const startWorldExtent = localExtent * Math.abs(startWorldScale[ax]);
      if (startWorldExtent < G.MIN_WORLD_DIMENSION) return;
      const drag1dEffective = drag.altKey ? drag1d * 2 : drag1d;
      const wantedExtent = startWorldExtent + drag1dEffective * sign;
      const snapped = Math.max(G.MIN_WORLD_DIMENSION, snap(wantedExtent, snapStep));
      const factor = snapped / startWorldExtent;
      newScale[ax] = factor * startScaleVal;
      factors.push(factor);
    };
    setAxis('x', scaleSigns.x, drags.x);
    setAxis('y', scaleSigns.y, drags.y);
    setAxis('z', scaleSigns.z, drags.z);
  } else {
    const localXInWorld = worldUnitAxis(new THREE.Vector3(1, 0, 0), drag.startMatrixWorld);
    const localYInWorld = worldUnitAxis(new THREE.Vector3(0, 1, 0), drag.startMatrixWorld);
    const localZInWorld = worldUnitAxis(new THREE.Vector3(0, 0, 1), drag.startMatrixWorld);
    const closestLocalAxis = (worldDir: THREE.Vector3): Axis => {
      const ax = Math.abs(localXInWorld.dot(worldDir));
      const ay = Math.abs(localYInWorld.dot(worldDir));
      const az = Math.abs(localZInWorld.dot(worldDir));
      if (ax >= ay && ax >= az) return 'x';
      return ay >= az ? 'y' : 'z';
    };
    const localDelta: Record<Axis, number> = { x: 0, y: 0, z: 0 };
    const accumulate = (sign: number, drag1d: number, worldDir: THREE.Vector3) => {
      if (sign === 0) return;
      const L = closestLocalAxis(worldDir);
      const drag1dEffective = drag.altKey ? drag1d * 2 : drag1d;
      localDelta[L] += drag1dEffective * sign;
    };
    accumulate(scaleSigns.x, drags.x, dirX);
    accumulate(scaleSigns.y, drags.y, dirY);
    accumulate(scaleSigns.z, drags.z, dirZ);
    for (const L of ['x', 'y', 'z'] as Axis[]) {
      if (localDelta[L] === 0) continue;
      const localExtent = L === 'x' ? obbSize.x : L === 'y' ? obbSize.y : obbSize.z;
      if (localExtent < G.MIN_LOCAL_DIMENSION) continue;
      const startScaleVal = drag.startScale[L];
      const startWorldExtent = localExtent * Math.abs(startWorldScale[L]);
      if (startWorldExtent < G.MIN_WORLD_DIMENSION) continue;
      const wantedExtent = startWorldExtent + localDelta[L];
      const snapped = Math.max(G.MIN_WORLD_DIMENSION, snap(wantedExtent, snapStep));
      const factor = snapped / startWorldExtent;
      newScale[L] = factor * startScaleVal;
      factors.push(factor);
    }
  }

  if (drag.ctrlKey && factors.length > 0) {
    let dominant = 1;
    let bestDev = 0;
    for (const f of factors) {
      const dev = Math.abs(f - 1);
      if (dev > bestDev) { bestDev = dev; dominant = f; }
    }
    newScale.set(
      dominant * drag.startScale.x,
      dominant * drag.startScale.y,
      dominant * drag.startScale.z,
    );
  }

  target.scale.copy(newScale);
  target.position.copy(drag.startPosition);
  target.updateMatrixWorld(true);

  const newAnchorWorld = currentScaleAnchorWorld(target, ctx.space, scaleSigns, drag.anchorLocal, drag.altKey);
  const correctionWorld = drag.anchorWorld.clone().sub(newAnchorWorld);
  const correctionLocal = worldDeltaToParentLocal(correctionWorld, drag.parentInverseWorld);
  target.position.add(correctionLocal);
}
