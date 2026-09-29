import * as THREE from 'three';

export type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export type Axis = 'x' | 'y' | 'z';

export type HandleRole =
  | { kind: 'scale'; scaleSigns: THREE.Vector3; position: 'floor' | 'top' }
  | { kind: 'translate-floor' }
  | { kind: 'lift' }
  | { kind: 'rotate-trigger'; axis: Axis }
  // Click-button (not a drag handle): enter sculpt edit-mode on the selected
  // group's sculpt layer. See parts/sculptHandle.ts + EditGizmo sculpt wiring.
  | { kind: 'sculpt-edit' };

export type GizmoMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material> & {
  userData: { role: HandleRole };
};

export interface ActiveDrag {
  role: HandleRole;
  hitMesh: GizmoMesh;
  pointerId: number;
  pointerDownX: number;
  pointerDownY: number;
  movedPastThreshold: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  startScale: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startMatrixWorld: THREE.Matrix4;
  parentInverseWorld: THREE.Matrix4;
  anchorLocal: THREE.Vector3;
  anchorWorld: THREE.Vector3;
  startPointerWorld: THREE.Vector3;
  rotateAxisWorld: THREE.Vector3;
  rotateOriginWorld: THREE.Vector3;
  startRotateAngle: number;
  currentRotateAngle: number;
}

export interface GizmoMaterials {
  outline: THREE.LineBasicMaterial;
  handleFill: THREE.MeshBasicMaterial;
  handleEdge: THREE.LineBasicMaterial;
  floor: THREE.MeshBasicMaterial;
  lift: THREE.MeshBasicMaterial;
  rotateX: THREE.MeshBasicMaterial;
  rotateY: THREE.MeshBasicMaterial;
  rotateZ: THREE.MeshBasicMaterial;
  sculpt: THREE.MeshBasicMaterial;
  dialRing: THREE.MeshBasicMaterial;
  dialTick: THREE.LineBasicMaterial;
  dialNeedle: THREE.LineBasicMaterial;
}

export { formatMM } from './format';
