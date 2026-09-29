import * as THREE from 'three';
import { GIZMO_CONSTANTS as G } from '../constants';
import type { GizmoMesh } from '../internal';

export function buildFloorTranslateRing(material: THREE.MeshBasicMaterial): GizmoMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material) as unknown as GizmoMesh;
  mesh.userData = { role: { kind: 'translate-floor' } };
  mesh.renderOrder = G.RENDER_ORDER - 1;
  return mesh;
}
