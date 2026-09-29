import * as THREE from 'three';
import { worldUpThree } from '../coords';
import { GIZMO_CONSTANTS as G } from '../constants';
import { getTouchScale } from '../touchScale';
import { worldUnitsPerPixel } from '../math';
import type { Axis, Camera, GizmoMaterials, GizmoMesh } from '../internal';

export interface RotateTriggerSet {
  x: GizmoMesh;
  y: GizmoMesh;
  z: GizmoMesh;
  arcGeo: THREE.BufferGeometry;
  ringGeo: THREE.BufferGeometry;
}

export function buildRotateTriggers(mats: GizmoMaterials): RotateTriggerSet {
  const arcGeo = new THREE.TorusGeometry(0.45, 0.09, 6, 16, Math.PI);
  const ringGeo = new THREE.TorusGeometry(0.45, 0.09, 6, 32);
  const make = (axis: Axis, mat: THREE.Material, geo: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(geo, mat) as unknown as GizmoMesh;
    mesh.userData = { role: { kind: 'rotate-trigger', axis } };
    mesh.renderOrder = G.RENDER_ORDER + 2;
    return mesh;
  };
  return {
    x: make('x', mats.rotateX, arcGeo),
    y: make('y', mats.rotateY, arcGeo),
    z: make('z', mats.rotateZ, arcGeo),
    arcGeo,
    ringGeo,
  };
}

export interface RotateTriggerVisibilityParams {
  targetObject: THREE.Object3D | null;
  camera: Camera;
  space: 'local' | 'world';
}

export function computeRotateTriggerVisibility(params: RotateTriggerVisibilityParams): Record<Axis, boolean> {
  const { targetObject, camera, space } = params;
  if (!targetObject) return { x: false, y: false, z: false };
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);

  const triggerQuat = new THREE.Quaternion();
  if (space === 'local') {
    targetObject.matrixWorld.decompose(new THREE.Vector3(), triggerQuat, new THREE.Vector3());
  }
  const wx = new THREE.Vector3(1, 0, 0).applyQuaternion(triggerQuat).normalize();
  const wy = new THREE.Vector3(0, 1, 0).applyQuaternion(triggerQuat).normalize();
  const wz = new THREE.Vector3(0, 0, 1).applyQuaternion(triggerQuat).normalize();
  const alignment = {
    x: Math.abs(wx.dot(camForward)),
    y: Math.abs(wy.dot(camForward)),
    z: Math.abs(wz.dot(camForward)),
  };
  const maxAlign = Math.max(alignment.x, alignment.y, alignment.z);
  const dominant = maxAlign >= G.ROTATE_TRIGGER_DOMINANT_DOT;
  const visible = (a: number) =>
    dominant ? a === maxAlign : a > G.ROTATE_TRIGGER_VIS_DOT;
  return {
    x: visible(alignment.x),
    y: visible(alignment.y),
    z: visible(alignment.z),
  };
}

export interface LayoutRotationTriggersParams {
  targetObject: THREE.Object3D | null;
  rotateTriggers: { x: GizmoMesh; y: GizmoMesh; z: GizmoMesh };
  camera: Camera;
  /** Canvas height in CSS px — passed in (the caller already measured it) so
   *  this layout never forces a reflow via getBoundingClientRect per axis. */
  viewportHeight: number;
  box: THREE.Box3;
  obbGroupMatrixWorld: THREE.Matrix4;
  space: 'local' | 'world';
  pixelWorld: number;
  rotateTriggerVisibility: Record<Axis, boolean>;
}

export function layoutRotationTriggers(params: LayoutRotationTriggersParams): void {
  const {
    targetObject,
    rotateTriggers,
    camera,
    viewportHeight,
    box,
    obbGroupMatrixWorld,
    space,
    pixelWorld,
    rotateTriggerVisibility,
  } = params;
  if (!targetObject) return;

  const cameraPos = new THREE.Vector3();
  camera.getWorldPosition(cameraPos);
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);

  const obbCenterWorld = box.getCenter(new THREE.Vector3()).applyMatrix4(obbGroupMatrixWorld);
  const cameraBelow = cameraPos.y < obbCenterWorld.y;
  const ySign = cameraBelow ? -1 : 1;
  const worldUp = worldUpThree();

  const triggerQuat = new THREE.Quaternion();
  if (space === 'local') {
    targetObject.matrixWorld.decompose(new THREE.Vector3(), triggerQuat, new THREE.Vector3());
  }

  const worldAxisX = new THREE.Vector3(1, 0, 0).applyQuaternion(triggerQuat).normalize();
  const worldAxisY = new THREE.Vector3(0, 1, 0).applyQuaternion(triggerQuat).normalize();
  const worldAxisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(triggerQuat).normalize();

  const isVisible = (ax: Axis) => rotateTriggerVisibility[ax];

  const camFromCenter = cameraPos.clone().sub(obbCenterWorld);
  const farSignX = camFromCenter.dot(worldAxisX) >= 0 ? -1 : 1;
  const farSignZ = camFromCenter.dot(worldAxisZ) >= 0 ? -1 : 1;

  const cxLocal = (box.min.x + box.max.x) / 2;
  const czLocal = (box.min.z + box.max.z) / 2;
  const topYLocal = cameraBelow ? box.min.y : box.max.y;
  const farXLocal = farSignX > 0 ? box.max.x : box.min.x;
  const farZLocal = farSignZ > 0 ? box.max.z : box.min.z;

  const localPos = {
    x: new THREE.Vector3(farXLocal, topYLocal, czLocal),
    y: new THREE.Vector3(cxLocal, topYLocal, czLocal),
    z: new THREE.Vector3(cxLocal, topYLocal, farZLocal),
  };

  const triggerSize = pixelWorld * G.ROTATE_TRIGGER_PX * getTouchScale();

  const align = {
    x: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    y: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
    z: new THREE.Quaternion(),
  };
  const worldAxis = { x: worldAxisX, y: worldAxisY, z: worldAxisZ };

  const orient = (ax: Axis) => {
    const trigger = rotateTriggers[ax];
    const visible = isVisible(ax);
    trigger.visible = visible;

    const worldPos = localPos[ax].clone().applyMatrix4(obbGroupMatrixWorld);
    const posPixel = worldUnitsPerPixel(camera, worldPos, viewportHeight);
    worldPos.addScaledVector(worldUp, ySign * posPixel * G.ROTATE_TRIGGER_EDGE_LIFT_PX);
    trigger.position.copy(worldPos);
    trigger.scale.setScalar(triggerSize);

    if (!visible) return;

    const axisW = worldAxis[ax];
    const baseQuat = triggerQuat.clone().multiply(align[ax]);
    const initialApex = new THREE.Vector3(0, 1, 0).applyQuaternion(baseQuat);

    let desiredApex: THREE.Vector3;
    if (ax === 'y') {
      desiredApex = worldPos.clone().sub(cameraPos);
    } else {
      desiredApex = worldUp.clone().multiplyScalar(ySign);
    }

    desiredApex.addScaledVector(axisW, -desiredApex.dot(axisW));
    if (desiredApex.lengthSq() < 1e-9) {
      trigger.quaternion.copy(baseQuat);
      return;
    }
    desiredApex.normalize();

    const cross = new THREE.Vector3().crossVectors(initialApex, desiredApex);
    const angle = Math.atan2(cross.dot(axisW), initialApex.dot(desiredApex));
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(axisW, angle);
    trigger.quaternion.copy(rollQuat).multiply(baseQuat);
  };

  orient('x');
  orient('y');
  orient('z');
}
