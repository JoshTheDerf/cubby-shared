import * as THREE from 'three';
import { EditGizmo, type GizmoMode, type GizmoSpace } from './EditGizmo';
import type { Camera } from './internal';

/**
 * TransformGizmo — the EditGizmo behind a small host-facing API.
 *
 * EditGizmo is written against the editor's scene: it manipulates ONE
 * Object3D, reports through single-slot callbacks keyed on
 * `userData.nodeId`, and its layout is Y-up (floor ring on the XZ plane, lift
 * along +Y). This wrapper lets any three.js host use it unchanged:
 *
 * - **Targets.** `attach()` takes an object, a list of objects (multi-select)
 *   or a bare matrix. The gizmo drives an invisible proxy (like the editor's
 *   MultiSelectionProxy) whose inner meshes share the targets' geometry, so
 *   the box is exact; drags are relayed to the targets as a world-space delta.
 * - **Up axis.** With `up: 'z'` (bed / CAD coordinates) the gizmo runs in a
 *   Y-up view of the host world: the proxy and a mirror camera live in that
 *   view, and the gizmo is parented under the fixed basis change `F` (a +90°
 *   turn about X: view +Y → world +Z) so it renders where the host expects.
 *   Deltas come back as `F · Δview · F⁻¹`, so every handle points along the
 *   host's axes.
 * - **Events.** 'grab-changed' (pointerdown on a handle / release — suspend
 *   orbit on it), 'drag-start', 'change' and 'drag-end' (with the proxy's
 *   world matrix and the delta since drag start), 'hover-changed' (repaint).
 *   A click on a handle without moving fires only 'grab-changed'.
 *
 * The host adds `object` to its scene, calls `update()` before each render,
 * and uses `hitTest()` to keep its own pointer handling off gizmo gestures.
 */

export type GizmoUp = 'y' | 'z';

/** What the gizmo manipulates: one object, several (moved as a group), or a
 *  matrix with an optional box in its local frame (unit cube by default). */
export type GizmoTarget =
  | THREE.Object3D
  | readonly THREE.Object3D[]
  | { matrix: THREE.Matrix4; bounds?: THREE.Box3 };

export interface TransformGizmoOptions {
  /** The host world's up axis. Default 'y' (three.js convention). */
  up?: GizmoUp;
  /** Write each drag step into the targets' transforms. Default true; with
   *  false the host applies `delta` itself (e.g. to a matrix target). */
  applyToTargets?: boolean;
  /** Only the primary button (left mouse, touch, pen) grabs handles, like
   *  three's TransformControls. Default true. */
  primaryButtonOnly?: boolean;
}

export interface TransformGizmoAttachOptions {
  /** When false, scale handles + dimension labels are hidden. */
  allowScale?: boolean;
}

export interface GizmoTransformEvent {
  /** The manipulated frame's world matrix now (the attached object's matrix
   *  for a single target, the group frame for several). */
  matrix: THREE.Matrix4;
  /** World-space change since drag start: `target' = delta · target`. */
  delta: THREE.Matrix4;
}

export interface TransformGizmoEventMap {
  'grab-changed': { value: boolean };
  'drag-start': { matrix: THREE.Matrix4 };
  'change': GizmoTransformEvent;
  'drag-end': GizmoTransformEvent;
  'hover-changed': object;
}

const PROXY_NODE_ID = '__cubby-gizmo__';

export class TransformGizmo extends THREE.EventDispatcher<TransformGizmoEventMap> {
  /** Add this to the host scene (it carries the up-axis basis change). */
  readonly object = new THREE.Group();
  /** The wrapped editor gizmo, for hosts that need its finer switches. */
  readonly core: EditGizmo;

  private camera: Camera;
  private readonly domElement: HTMLElement;
  /** Camera as seen from the gizmo's Y-up view (the host camera when up = 'y'). */
  private view: Camera;
  /** View → world basis change `F`, and its inverse; null when up = 'y'. */
  private readonly fromView: THREE.Matrix4 | null;
  private readonly toView: THREE.Matrix4 | null;
  private readonly applyToTargets: boolean;

  /** Orphan proxy the gizmo drives, in view space. */
  private readonly proxy = new THREE.Group();
  private readonly proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private proxyBoxGeometry: THREE.BufferGeometry | null = null;
  private targets: THREE.Object3D[] = [];
  private isAttached = false;
  private shown = true;

  private drag: { start: THREE.Matrix4; startInv: THREE.Matrix4; worlds: THREE.Matrix4[] } | null = null;
  private grab = false;
  private readonly onPointer: () => void;

  constructor(camera: Camera, domElement: HTMLElement, opts: TransformGizmoOptions = {}) {
    super();
    this.camera = camera;
    this.domElement = domElement;
    this.applyToTargets = opts.applyToTargets ?? true;
    if (opts.up === 'z') {
      this.fromView = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      this.toView = this.fromView.clone().invert();
      this.view = camera.clone();
    } else {
      this.fromView = null;
      this.toView = null;
      this.view = camera;
    }
    this.object.name = 'transform-gizmo';
    this.object.matrixAutoUpdate = false;
    if (this.fromView) this.object.matrix.copy(this.fromView);

    // Registered BEFORE the gizmo's own listeners so the mirror camera is
    // current when it hit-tests the same event.
    this.onPointer = () => this.syncView();
    domElement.addEventListener('pointerdown', this.onPointer);
    domElement.addEventListener('pointermove', this.onPointer);

    this.core = new EditGizmo(this.view, domElement);
    this.core.setPrimaryButtonOnly(opts.primaryButtonOnly ?? true);
    this.object.add(this.core);
    this.proxy.userData.nodeId = PROXY_NODE_ID;

    this.core.setOnGrabChange((grabbed) => {
      this.grab = grabbed;
      this.dispatchEvent({ type: 'grab-changed', value: grabbed });
    });
    this.core.addEventListener('dragging-changed', (e) => {
      if (e.value) this.beginDrag();
      else this.endDrag();
    });
    this.core.setOnObjectChange(() => this.applyDrag());
    this.core.addEventListener('hover-changed', () => this.dispatchEvent({ type: 'hover-changed' }));
  }

  // ── Attachment ──────────────────────────────────────────────────────────

  /** Attach to a target (re-attaching refits the box to its current pose). */
  attach(target: GizmoTarget, opts: TransformGizmoAttachOptions = {}): void {
    if (this.drag) return;
    this.core.detach();
    this.clearProxy();
    const view = new THREE.Matrix4();
    const inners: Array<{ geometry: THREE.BufferGeometry; world: THREE.Matrix4 }> = [];

    if (target instanceof THREE.Object3D || Array.isArray(target)) {
      const list = (target instanceof THREE.Object3D ? [target] : [...target]) as THREE.Object3D[];
      if (!list.length) { this.detach(); return; }
      for (const o of list) {
        o.updateWorldMatrix(true, true);
        o.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh && m.geometry) inners.push({ geometry: m.geometry, world: m.matrixWorld });
        });
      }
      if (list.length === 1) {
        view.copy(this.worldToView(list[0].matrixWorld));
      } else {
        // Group frame: axis-aligned at the selection's box centre.
        const box = new THREE.Box3();
        for (const o of list) box.expandByObject(o);
        if (this.toView) box.applyMatrix4(this.toView);
        view.makeTranslation(box.getCenter(new THREE.Vector3()));
      }
      this.targets = list;
    } else {
      const t = target as { matrix: THREE.Matrix4; bounds?: THREE.Box3 };
      const bounds = t.bounds && !t.bounds.isEmpty()
        ? t.bounds
        : new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
      const size = bounds.getSize(new THREE.Vector3());
      this.proxyBoxGeometry = new THREE.BoxGeometry(Math.max(size.x, 1e-4), Math.max(size.y, 1e-4), Math.max(size.z, 1e-4));
      this.proxyBoxGeometry.computeBoundingBox();
      inners.push({
        geometry: this.proxyBoxGeometry,
        world: t.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(bounds.getCenter(new THREE.Vector3()))),
      });
      view.copy(this.worldToView(t.matrix));
      this.targets = [];
    }

    view.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
    this.proxy.updateMatrixWorld(true);
    // inner = proxy⁻¹ · F⁻¹ · meshWorld: the target geometry, placed in the
    // proxy's frame so localOBBOf / setFromObject see the real extent.
    const proxyInv = this.proxy.matrixWorld.clone().invert();
    for (const { geometry, world } of inners) {
      const mesh = new THREE.Mesh(geometry, this.proxyMaterial);
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.multiplyMatrices(proxyInv, this.toView ? this.toView.clone().multiply(world) : world);
      this.proxy.add(mesh);
    }
    this.proxy.updateMatrixWorld(true);

    this.syncView();
    this.core.attach(this.proxy, opts.allowScale === false ? { allowScale: false } : undefined);
    this.isAttached = true;
    this.core.visible = this.shown;
  }

  detach(): void {
    if (this.drag) this.endDrag();
    this.core.detach();
    this.clearProxy();
    this.targets = [];
    this.isAttached = false;
  }

  get attached(): boolean { return this.isAttached; }

  private clearProxy(): void {
    for (const c of [...this.proxy.children]) this.proxy.remove(c);
    this.proxyBoxGeometry?.dispose();
    this.proxyBoxGeometry = null;
  }

  // ── Settings ────────────────────────────────────────────────────────────

  setMode(mode: GizmoMode): void { this.core.setMode(mode); }
  getMode(): GizmoMode { return this.core.getMode(); }
  setSpace(space: GizmoSpace): void { this.core.setSpace(space); }
  getSpace(): GizmoSpace { return this.core.getSpace(); }
  /** Snap step in world units for moves and box extents; any step > 0 also
   *  snaps rotation to 15°. 0 turns snapping off. */
  setSnap(increment: number): void { this.core.setSnapIncrement(increment); }
  /** Shift engages the snap (true) instead of bypassing it (false, default). */
  setShiftEngagesSnap(on: boolean): void { this.core.setShiftEngagesSnap(on); }
  setLiftVisible(on: boolean): void { this.core.setLiftVisible(on); }
  setRotationVisible(on: boolean): void { this.core.setRotationVisible(on); }

  /** Show / hide without detaching (hidden handles don't take pointer events). */
  get visible(): boolean { return this.shown; }
  set visible(v: boolean) {
    this.shown = v;
    this.core.visible = v && this.isAttached;
  }
  show(): void { this.visible = true; }
  hide(): void { this.visible = false; }

  // ── Host integration ────────────────────────────────────────────────────

  /** Follow a different host camera (perspective ↔ orthographic switch). */
  setCamera(camera: Camera): void {
    if (camera === this.camera) return;
    this.camera = camera;
    this.view = this.toView ? camera.clone() : camera;
    this.core.camera = this.view;
    this.syncView();
    if (this.isAttached) {
      this.core.update();
      this.core.updateHandleSizes();
    }
  }

  /** Would a pointer at this position grab a handle? */
  hitTest(event: { clientX: number; clientY: number }): boolean {
    if (!this.isAttached || !this.shown) return false;
    this.syncView();
    return this.core.hitsHandle(event);
  }

  /** A handle is held (pointerdown → release), moved or not. */
  get grabbed(): boolean { return this.grab; }
  /** A transform is in progress (past the click threshold). */
  get dragging(): boolean { return this.drag !== null; }

  /** Per-frame layout (handle sizes follow the camera). Call before rendering. */
  update(): void {
    if (!this.isAttached) return;
    this.syncView();
    this.core.update();
    this.core.updateHandleSizes();
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointer);
    this.domElement.removeEventListener('pointermove', this.onPointer);
    this.detach();
    this.core.dispose();
    this.proxyMaterial.dispose();
    this.object.removeFromParent();
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** World matrix → view space, conjugated so the frame's own Y is "up". */
  private worldToView(m: THREE.Matrix4): THREE.Matrix4 {
    if (!this.toView || !this.fromView) return m.clone();
    return this.toView.clone().multiply(m).multiply(this.fromView);
  }

  private viewToWorld(m: THREE.Matrix4): THREE.Matrix4 {
    if (!this.toView || !this.fromView) return m.clone();
    return this.fromView.clone().multiply(m).multiply(this.toView);
  }

  /** Mirror the host camera into view space. */
  private syncView(): void {
    if (this.view === this.camera || !this.toView) return;
    this.camera.updateMatrixWorld();
    (this.view as { copy(c: Camera, recursive: boolean): unknown }).copy(this.camera, false);
    new THREE.Matrix4()
      .multiplyMatrices(this.toView, this.camera.matrixWorld)
      .decompose(this.view.position, this.view.quaternion, this.view.scale);
    this.view.updateMatrixWorld(true);
  }

  private proxyWorld(): THREE.Matrix4 {
    this.proxy.updateMatrixWorld(true);
    return this.viewToWorld(this.proxy.matrixWorld);
  }

  private beginDrag(): void {
    const start = this.proxyWorld();
    this.drag = {
      start,
      startInv: start.clone().invert(),
      worlds: this.targets.map((t) => { t.updateWorldMatrix(true, false); return t.matrixWorld.clone(); }),
    };
    this.dispatchEvent({ type: 'drag-start', matrix: start.clone() });
  }

  private applyDrag(): void {
    const d = this.drag;
    if (!d) return;
    const matrix = this.proxyWorld();
    const delta = matrix.clone().multiply(d.startInv);
    if (this.applyToTargets) {
      const parentInv = new THREE.Matrix4();
      const local = new THREE.Matrix4();
      this.targets.forEach((t, i) => {
        local.multiplyMatrices(delta, d.worlds[i]);
        if (t.parent) {
          t.parent.updateWorldMatrix(true, false);
          parentInv.copy(t.parent.matrixWorld).invert();
          local.premultiply(parentInv);
        }
        local.decompose(t.position, t.quaternion, t.scale);
        t.updateMatrixWorld(true);
      });
    }
    this.dispatchEvent({ type: 'change', matrix, delta });
  }

  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    const matrix = this.proxyWorld();
    const delta = matrix.clone().multiply(d.startInv);
    this.drag = null;
    this.dispatchEvent({ type: 'drag-end', matrix, delta });
  }
}
