import * as THREE from 'three';
import { GIZMO_CONSTANTS as G } from '../constants';
import type { GizmoMesh } from '../internal';

/**
 * "Edit sculpt layer" handle — a small click-button that floats outside the
 * selection's bounding box whenever the selected group contains a sculpt layer.
 * Clicking it (a click, never a drag) enters sculpt edit-mode on that layer.
 *
 * A sphere reads as a distinct, button-like affordance next to the cube scale
 * handles and the cone lift handle. Sized/positioned by EditGizmo each frame
 * (pixel-constant), like the other handles.
 */
export function buildSculptHandle(material: THREE.MeshBasicMaterial): GizmoMesh {
  const geo = new THREE.SphereGeometry(0.6, 20, 14);
  const mesh = new THREE.Mesh(geo, material) as unknown as GizmoMesh;
  mesh.userData = { role: { kind: 'sculpt-edit' } };
  // Above the rest of the gizmo so it never z-fights the outline/handles.
  mesh.renderOrder = G.RENDER_ORDER + 2;
  mesh.visible = false;
  return mesh;
}
