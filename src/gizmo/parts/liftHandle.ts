import * as THREE from 'three';
import { GIZMO_CONSTANTS as G } from '../constants';
import type { GizmoMesh } from '../internal';

export function buildLiftHandle(material: THREE.MeshBasicMaterial): GizmoMesh {
  const geo = new THREE.ConeGeometry(0.5, 1, 16);
  const mesh = new THREE.Mesh(geo, material) as unknown as GizmoMesh;
  mesh.userData = { role: { kind: 'lift' } };
  mesh.renderOrder = G.RENDER_ORDER + 1;
  return mesh;
}
