import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GIZMO_CONSTANTS as G } from '../constants';
import type { Axis, GizmoMaterials } from '../internal';

export interface DialGroup {
  group: THREE.Group;
  ring: THREE.Mesh;
  ticks: THREE.LineSegments;
  needle: THREE.Line;
  readout: CSS2DObject;
}

export function buildDialGroup(mats: GizmoMaterials): DialGroup {
  const group = new THREE.Group();

  const ringGeo = new THREE.RingGeometry(0.96, 1.0, 96);
  const ring = new THREE.Mesh(ringGeo, mats.dialRing);
  ring.renderOrder = G.RENDER_ORDER + 3;
  group.add(ring);

  const positions: number[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const len = deg % 90 === 0 ? 0.18 : deg % 15 === 0 ? 0.10 : 0.05;
    const r1 = 1.0 - len;
    const r2 = 1.0;
    positions.push(Math.cos(a) * r1, Math.sin(a) * r1, 0);
    positions.push(Math.cos(a) * r2, Math.sin(a) * r2, 0);
  }
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const ticks = new THREE.LineSegments(tickGeo, mats.dialTick);
  ticks.renderOrder = G.RENDER_ORDER + 4;
  group.add(ticks);

  const needleGeo = new THREE.BufferGeometry();
  needleGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
  const needle = new THREE.Line(needleGeo, mats.dialNeedle);
  needle.renderOrder = G.RENDER_ORDER + 5;
  group.add(needle);

  const div = document.createElement('div');
  div.className = 'cubby-3d-label';
  div.style.cssText = `
    font: 12px ui-monospace, Menlo, monospace;
    padding: 2px 6px;
    border-radius: 3px;
    pointer-events: none;
    transform: translate(-50%, -50%);
    border: 1px solid #888;
  `;
  div.textContent = '0°';
  const readout = new CSS2DObject(div);
  group.add(readout);

  return { group, ring, ticks, needle, readout };
}

export function layoutDial(
  dialGroup: THREE.Group,
  box: THREE.Box3,
  axis: Axis,
  invScale: THREE.Vector3,
): void {
  const center = box.getCenter(new THREE.Vector3());
  dialGroup.position.copy(center);
  dialGroup.rotation.set(0, 0, 0);
  if (axis === 'x') dialGroup.rotation.y = Math.PI / 2;
  else if (axis === 'y') dialGroup.rotation.x = -Math.PI / 2;

  const size = box.getSize(new THREE.Vector3());
  const pad = 1.15;
  let r: number;
  if (axis === 'x') r = pad * Math.max(size.y * invScale.y, size.z * invScale.z) / 2;
  else if (axis === 'y') r = pad * Math.max(size.x * invScale.x, size.z * invScale.z) / 2;
  else r = pad * Math.max(size.x * invScale.x, size.y * invScale.y) / 2;
  if (axis === 'x') dialGroup.scale.set(1, invScale.y, invScale.z).multiplyScalar(r);
  else if (axis === 'y') dialGroup.scale.set(invScale.x, 1, invScale.z).multiplyScalar(r);
  else dialGroup.scale.set(invScale.x, invScale.y, 1).multiplyScalar(r);
}

export function updateDialNeedle(
  needle: THREE.Line,
  readout: CSS2DObject,
  deltaAngle: number,
): void {
  needle.rotation.set(0, 0, deltaAngle);
  const tip = new THREE.Vector3(Math.cos(deltaAngle), Math.sin(deltaAngle), 0).multiplyScalar(1.08);
  readout.position.copy(tip);
  const deg = THREE.MathUtils.radToDeg(deltaAngle);
  (readout.element as HTMLElement).textContent = `${deg.toFixed(1)}°`;
}
