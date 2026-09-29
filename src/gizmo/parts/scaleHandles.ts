import * as THREE from 'three';
import { worldUpThree } from '../coords';
import { getTouchScale } from '../touchScale';
import { GIZMO_CONSTANTS as G } from '../constants';
import { boxPoint } from '../math';
import type { Axis, GizmoMesh, GizmoMaterials } from '../internal';

/**
 * Build the nine scale handles: 4 floor corners, 4 floor edge-midpoints, and one
 * contextual vertical handle (top, flipped to the floor when the camera is
 * below — see `applyVerticalFlip`).
 *
 * Takes only the two materials it actually uses, so callers that are not the
 * full EditGizmo can reuse it — the sculpt SELECT tool's selection box does
 * (`core/sculpt/selectHandles.ts`), which is what keeps the two handle sets
 * identical rather than merely similar.
 */
export function buildScaleHandles(
  mats: Pick<GizmoMaterials, 'handleFill' | 'handleEdge'>,
): GizmoMesh[] {
  const out: GizmoMesh[] = [];
  const handleGeo = new THREE.BoxGeometry(1, 1, 1);
  const make = (scaleSigns: THREE.Vector3, position: 'floor' | 'top') => {
    const mat = mats.handleFill.clone();
    const mesh = new THREE.Mesh(handleGeo, mat) as unknown as GizmoMesh;
    mesh.userData = { role: { kind: 'scale', scaleSigns, position } };
    mesh.renderOrder = G.RENDER_ORDER + 1;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(handleGeo), mats.handleEdge);
    mesh.add(edges);
    return mesh;
  };

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push(make(new THREE.Vector3(sx, 0, sz), 'floor'));
    }
  }
  out.push(make(new THREE.Vector3(1, 0, 0), 'floor'));
  out.push(make(new THREE.Vector3(-1, 0, 0), 'floor'));
  out.push(make(new THREE.Vector3(0, 0, 1), 'floor'));
  out.push(make(new THREE.Vector3(0, 0, -1), 'floor'));
  out.push(make(worldUpThree(), 'top'));
  return out;
}

export function layoutScaleHandles(
  scaleHandles: GizmoMesh[],
  box: THREE.Box3,
  outline: THREE.LineSegments,
  floorOutline: GizmoMesh,
  liftHandle: GizmoMesh,
): void {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  outline.position.copy(center);
  outline.scale.set(Math.max(size.x, 1e-6), Math.max(size.y, 1e-6), Math.max(size.z, 1e-6));

  floorOutline.position.set(center.x, box.min.y + 1e-3, center.z);
  floorOutline.scale.set(Math.max(size.x, 1e-6), 1, Math.max(size.z, 1e-6));

  for (const h of scaleHandles) {
    const role = h.userData.role;
    if (role.kind !== 'scale') continue;
    const ySign = role.position === 'floor' ? -1 : 1;
    const layoutSigns = new THREE.Vector3(role.scaleSigns.x, ySign, role.scaleSigns.z);
    boxPoint(box, layoutSigns, h.position);
  }

  liftHandle.position.set(center.x, box.max.y, center.z);
}

export interface ApplyVerticalFlipParams {
  scaleHandles: GizmoMesh[];
  liftHandle: GizmoMesh;
  box: THREE.Box3;
  cameraBelow: boolean;
  pixelWorld: number;
  invY: number;
  yRotateVisible: boolean;
  hasActiveDrag: boolean;
}

export function applyVerticalFlip(params: ApplyVerticalFlipParams): void {
  const { scaleHandles, liftHandle, box, cameraBelow, pixelWorld, invY, yRotateVisible, hasActiveDrag } = params;
  const center = box.getCenter(new THREE.Vector3());
  const desiredYSign = cameraBelow ? -1 : 1;
  const desiredPosition: 'floor' | 'top' = cameraBelow ? 'floor' : 'top';
  // Lift cone clearance must scale with touch-handle size, otherwise the
  // up/down arrow's enlarged base overlaps the enlarged top scale handle on
  // mobile and they become hard to distinguish by touch. Adding an extra
  // CSS-pixel bump on touch widens the visible gap further.
  const ts = getTouchScale();
  const touchExtra = (ts - 1) * G.LIFT_TOUCH_EXTRA_OFFSET_PX;
  const offsetLocal = (G.LIFT_OFFSET_PX * ts + touchExtra) * pixelWorld * invY;

  if (!hasActiveDrag) {
    for (const h of scaleHandles) {
      const role = h.userData.role;
      if (role.kind !== 'scale') continue;
      if (role.scaleSigns.y === 0) continue;
      h.visible = !yRotateVisible;
      if (role.scaleSigns.y !== desiredYSign || role.position !== desiredPosition) {
        role.scaleSigns.y = desiredYSign;
        role.position = desiredPosition;
      }
      const y = desiredPosition === 'top' ? box.max.y : box.min.y;
      h.position.set(center.x, y, center.z);
    }
  }

  const liftY = cameraBelow ? box.min.y - offsetLocal : box.max.y + offsetLocal;
  liftHandle.position.set(center.x, liftY, center.z);
  liftHandle.rotation.x = cameraBelow ? Math.PI : 0;
}

export type { Axis };
