import * as THREE from 'three';
import type { Camera } from '../internal';

export interface DragContext {
  targetObject: THREE.Object3D;
  camera: Camera;
  raycaster: THREE.Raycaster;
  localBox: THREE.Box3;
  obbBox: THREE.Box3;
  obbGroupMatrixWorld: THREE.Matrix4;
  space: 'local' | 'world';
  snapIncrement: number;
  /** World-space "up" for the translate drags: the floor ring slides in the
   *  plane perpendicular to this and the lift handle moves along it. World-up
   *  for ordinary nodes; a face normal when the mesh-edit mode attaches the
   *  gizmo to a face selection (the "planar" gizmo variant). */
  up: THREE.Vector3;
}
