import * as THREE from 'three';
import { boxPoint } from './math';

/**
 * GizmoDebugOverlay — visual overlay for inspecting the gizmo's internal state.
 *
 * Toggle from devtools:  window.__GIZMO_DEBUG__ = true
 * Then move the cursor over a selected object and start a drag — markers will
 * appear at the anchor, drag start point, current cursor projection, and OBB
 * corners. Disable by setting back to false (or undefined).
 *
 * The whole point is to make the next bug obvious in 30 seconds instead of
 * 30 minutes of console.log-driven mental simulation.
 */
export class GizmoDebugOverlay extends THREE.Object3D {
  private anchorMarker: THREE.Mesh;
  private startMarker: THREE.Mesh;
  private currentMarker: THREE.Mesh;
  private obbCorners: THREE.Mesh[] = [];
  private axisHelper: THREE.AxesHelper;

  // Material refs so we can dispose later.
  private materials: THREE.Material[] = [];

  constructor() {
    super();
    this.renderOrder = 10000;

    const sphere = new THREE.SphereGeometry(1, 12, 8);

    const mkMarker = (color: number) => {
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.renderOrder = 10001;
      mesh.visible = false;
      return mesh;
    };

    this.anchorMarker = mkMarker(0xff2222); // red — anchor (the face that should stay fixed)
    this.startMarker = mkMarker(0x22cc22); // green — drag start point
    this.currentMarker = mkMarker(0x2266ff); // blue — current cursor projection
    this.add(this.anchorMarker, this.startMarker, this.currentMarker);

    for (let i = 0; i < 8; i++) {
      const m = mkMarker(0xeebb00); // yellow — OBB corners (in world space)
      this.obbCorners.push(m);
      this.add(m);
    }

    this.axisHelper = new THREE.AxesHelper(1);
    this.axisHelper.visible = false;
    (this.axisHelper.material as THREE.Material).depthTest = false;
    this.add(this.axisHelper);

    this.visible = false;
  }

  /** Returns true if the global debug flag is on. */
  static isEnabled(): boolean {
    return typeof window !== 'undefined' && (window as { __GIZMO_DEBUG__?: boolean }).__GIZMO_DEBUG__ === true;
  }

  /** Apply the global flag's current value. Call once per frame from the gizmo. */
  syncFromGlobalFlag(): void {
    this.visible = GizmoDebugOverlay.isEnabled();
    if (!this.visible) {
      this.anchorMarker.visible = false;
      this.startMarker.visible = false;
      this.currentMarker.visible = false;
      this.axisHelper.visible = false;
      for (const c of this.obbCorners) c.visible = false;
    }
  }

  /**
   * Show the OBB corners and origin axes derived from `localBox` and the target's
   * world matrix. `markerWorldSize` should be in world units; pass world-units-per-pixel
   * times your desired pixel size.
   */
  showOBB(localBox: THREE.Box3, targetWorldMatrix: THREE.Matrix4, markerWorldSize: number): void {
    if (!this.visible) return;
    const corners: [number, number, number][] = [
      [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
      [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
    ];
    for (let i = 0; i < 8; i++) {
      const c = this.obbCorners[i];
      const local = boxPoint(localBox, new THREE.Vector3(...corners[i]));
      c.position.copy(local).applyMatrix4(targetWorldMatrix);
      c.scale.setScalar(markerWorldSize * 0.7);
      c.visible = true;
    }

    // Axis helper at OBB center, oriented by target's world matrix (so X/Y/Z reflect OBB axes).
    const center = localBox.getCenter(new THREE.Vector3()).applyMatrix4(targetWorldMatrix);
    this.axisHelper.position.copy(center);
    const q = new THREE.Quaternion();
    targetWorldMatrix.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    this.axisHelper.quaternion.copy(q);
    const axisLen = markerWorldSize * 6;
    this.axisHelper.scale.setScalar(axisLen);
    this.axisHelper.visible = true;
  }

  showAnchor(world: THREE.Vector3, markerWorldSize: number): void {
    if (!this.visible) return;
    this.anchorMarker.position.copy(world);
    this.anchorMarker.scale.setScalar(markerWorldSize);
    this.anchorMarker.visible = true;
  }

  showStartPoint(world: THREE.Vector3, markerWorldSize: number): void {
    if (!this.visible) return;
    this.startMarker.position.copy(world);
    this.startMarker.scale.setScalar(markerWorldSize * 0.8);
    this.startMarker.visible = true;
  }

  showCurrentPoint(world: THREE.Vector3, markerWorldSize: number): void {
    if (!this.visible) return;
    this.currentMarker.position.copy(world);
    this.currentMarker.scale.setScalar(markerWorldSize * 0.8);
    this.currentMarker.visible = true;
  }

  hideDragMarkers(): void {
    this.anchorMarker.visible = false;
    this.startMarker.visible = false;
    this.currentMarker.visible = false;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
  }
}
