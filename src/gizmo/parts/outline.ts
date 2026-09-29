import * as THREE from 'three';
import { GIZMO_CONSTANTS as G } from '../constants';

export function buildOutline(material: THREE.LineBasicMaterial): THREE.LineSegments {
  const c = [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
    [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ];
  const edges = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];
  const positions = new Float32Array(edges.length * 3);
  for (let i = 0; i < edges.length; i++) {
    const v = c[edges[i]];
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.LineSegments(geo, material);
  line.renderOrder = G.RENDER_ORDER;
  return line;
}
