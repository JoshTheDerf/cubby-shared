import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GIZMO_CONSTANTS as G } from './constants';
import { getTouchScale } from './touchScale';
import { worldUpThree } from './coords';
import { hapticCommit } from './haptics';
import {
  boxScaleAnchor,
  intersectRayPlane,
  localOBBOf,
  signedAngleAroundAxis,
  worldBoxToLocalBox,
  worldDeltaToParentLocal,
  worldUnitAxis,
  worldUnitsPerPixel,
} from './math';
import { GizmoDebugOverlay } from './debug';
import type {
  ActiveDrag,
  Axis,
  Camera,
  GizmoMaterials,
  GizmoMesh,
} from './internal';
import { buildOutline } from './parts/outline';
import { buildFloorTranslateRing } from './parts/floorRing';
import {
  applyVerticalFlip,
  buildScaleHandles,
  layoutScaleHandles,
} from './parts/scaleHandles';
import { buildLiftHandle } from './parts/liftHandle';
import { buildSculptHandle } from './parts/sculptHandle';
import {
  buildRotateTriggers,
  computeRotateTriggerVisibility,
  layoutRotationTriggers,
} from './parts/rotateTriggers';
import {
  buildDialGroup,
  layoutDial,
  updateDialNeedle,
} from './parts/dial';
import {
  buildDimensionLabels,
  endLabelEdit as endLabelEditPart,
  startLabelEdit as startLabelEditPart,
  updateDimensionLabels as updateDimensionLabelsPart,
  type DimensionLabelSet,
} from './parts/dimensionLabels';
import {
  applyScaleDrag,
  captureScaleAnchor,
  currentScaleAnchorWorld,
} from './drag/scale';
import { applyRotateDrag } from './drag/rotate';
import { applyFloorTranslate, applyLiftDrag } from './drag/translate';
import type { DragContext } from './drag/types';
import { setPickRayFromCamera } from './pickRay';

const IDENTITY = new THREE.Matrix4();

export type GizmoTransformCallback = (nodeId: string) => void;
export type GizmoObjectChangeCallback = (nodeId: string, matrix: number[]) => void;

export type GizmoSpace = 'local' | 'world';

/**
 * Which handle families are offered. 'all' is the editor's combined gizmo
 * (scale + floor-translate + lift + rotation arcs at once); the others keep
 * only one family, for hosts with a move / rotate / scale mode switch (the
 * slicer's M / R / S). The box outline shows in every mode.
 */
export type GizmoMode = 'all' | 'translate' | 'rotate' | 'scale';

/**
 * Per-attach capability flags (Bug 5).
 *
 * - `boundsOverride`: a callback returning a WORLD-space Box3 to use as the
 *   gizmo frame instead of deriving it from the target's geometry. Required for
 *   empty-geometry targets (skeleton stub Groups) whose `setFromObject` box is
 *   empty → a degenerate/invisible gizmo. Re-invoked on every update so the box
 *   follows the target live while dragging. Return null to fall back to the
 *   geometry-derived box.
 * - `allowScale`: when false, scale handles + dimension labels are hidden,
 *   leaving floor-translate + lift + rotation arcs (move + rotate only).
 */
export interface GizmoAttachOptions {
  boundsOverride?: () => THREE.Box3 | null;
  allowScale?: boolean;
  /** World-space "up" override for the translate drags: the floor ring slides
   *  in the plane perpendicular to it, the lift handle moves along it.
   *  Re-invoked per drag so it can follow a live selection. Return null to
   *  fall back to world-up. Used by the mesh-edit mode to make the gizmo
   *  planar to a selected face. */
  upOverride?: () => THREE.Vector3 | null;
}

/**
 * EditGizmo — TinkerCad-style transform gizmo.
 *
 * Default state: bounding-box editing (scale + floor-translate + Y-lift), plus
 * three small rotation-trigger handles on the OBB faces. Clicking a rotation
 * trigger swaps the visuals to a tick-marked dial perpendicular to that axis;
 * dragging rotates the object around that axis. On release, the dial hides
 * and the bounding-box handles return.
 *
 * All math is in the target's local OBB frame so rotation works correctly.
 */
export interface EditGizmoEventMap extends THREE.Object3DEventMap {
  'dragging-changed': { value: boolean };
  /** The handle under the pointer changed (hover tint) — on-demand renderers repaint. */
  'hover-changed': object;
}

export class EditGizmo extends THREE.Object3D<EditGizmoEventMap> {
  public targetObject: THREE.Object3D | null = null;
  public camera: Camera;
  private domElement: HTMLElement;

  private localBox: THREE.Box3 = new THREE.Box3();
  private obbBox: THREE.Box3 = new THREE.Box3();
  private space: GizmoSpace = 'world';

  // ── Per-attach capabilities (Bug 5) ──────────────────────────────────────
  // Targets with no geometry of their own (e.g. a skeleton stub Group) get
  // their world-space bounding box from this override callback instead of
  // setFromObject (which yields an empty/degenerate box). The callback runs on
  // EVERY update() so the box FOLLOWS live while the target moves/rotates.
  private boundsOverride: (() => THREE.Box3 | null) | null = null;
  // When false, all scale handles + dimension labels are hidden (move + rotate
  // only). Used for skeletons, where dimensions are meaningless.
  private allowScale = true;
  // World-space up override for the translate drags (mesh-edit face gizmo).
  private upOverride: (() => THREE.Vector3 | null) | null = null;

  private obbGroup = new THREE.Group();
  private outline!: THREE.LineSegments;
  private floorOutline!: GizmoMesh;
  private scaleHandles: GizmoMesh[] = [];
  private liftHandle!: GizmoMesh;
  private rotateTriggerGroup = new THREE.Group();
  private rotateTriggers!: { x: GizmoMesh; y: GizmoMesh; z: GizmoMesh };
  private rotateTriggerArcGeo!: THREE.BufferGeometry;
  private rotateTriggerRingGeo!: THREE.BufferGeometry;

  // "Edit sculpt layer" click-button. Shown outside the box only when the
  // selection is a group that holds a sculpt layer; `sculptLayerTargetId` is the
  // layer node id to enter. The id is pushed in from the Vue layer on selection
  // / scene change (cheap field read per frame — no scene-walk in the gizmo).
  private sculptHandle!: GizmoMesh;
  private sculptLayerTargetId: string | null = null;
  private onSculptEdit: ((nodeId: string) => void) | null = null;

  private dialGroup = new THREE.Group();
  private dialNeedle!: THREE.Line;
  private dialReadout!: CSS2DObject;

  private dimensionLabels!: DimensionLabelSet;

  private debug: GizmoDebugOverlay;

  // Opaque handle materials use depthFunc=AlwaysDepth (always passes the
  // depth test) instead of depthTest=false. The visual result is the same —
  // gizmo handles still draw on top of everything in the scene — but with
  // depthTest enabled, WebGL also performs depth writes. Without those
  // writes the depth buffer at a handle's pixels keeps the far-plane value,
  // and the transparent grid lines (drawn later in the transparent pass)
  // trivially pass their depth test and bleed over the handles. Writing the
  // handle's near-plane z prevents that grid-over-gizmo bleed-through.
  //
  // Transparent gizmo parts (outline, floor, dialRing*, dialTick) stay on
  // depthTest=false: they overlap each other and writing depth would cause
  // intra-gizmo sort glitches; they also render last in the transparent
  // pass at high renderOrder, so they're on top anyway.
  private mats: GizmoMaterials = {
    outline: new THREE.LineBasicMaterial({ color: G.OUTLINE_COLOR, transparent: true, opacity: 0.85, depthTest: false }),
    handleFill: new THREE.MeshBasicMaterial({ color: G.HANDLE_FILL, depthTest: true, depthFunc: THREE.AlwaysDepth }),
    handleEdge: new THREE.LineBasicMaterial({ color: G.HANDLE_EDGE, depthTest: true, depthFunc: THREE.AlwaysDepth }),
    floor: new THREE.MeshBasicMaterial({
      color: G.TRANSLATE_FLOOR_COLOR, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthTest: false,
    }),
    lift: new THREE.MeshBasicMaterial({ color: G.LIFT_COLOR, depthTest: true, depthFunc: THREE.AlwaysDepth }),
    rotateX: new THREE.MeshBasicMaterial({ color: G.ROTATE_COLOR, depthTest: true, depthFunc: THREE.AlwaysDepth }),
    rotateY: new THREE.MeshBasicMaterial({ color: G.ROTATE_COLOR, depthTest: true, depthFunc: THREE.AlwaysDepth }),
    rotateZ: new THREE.MeshBasicMaterial({ color: G.ROTATE_COLOR, depthTest: true, depthFunc: THREE.AlwaysDepth }),
    sculpt: new THREE.MeshBasicMaterial({ color: G.SCULPT_HANDLE_COLOR, depthTest: true, depthFunc: THREE.AlwaysDepth }),
    dialRing: new THREE.MeshBasicMaterial({ color: G.ROTATE_COLOR, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthTest: false }),
    dialTick: new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.85, depthTest: false }),
    dialNeedle: new THREE.LineBasicMaterial({ color: 0x222222, depthTest: true, depthFunc: THREE.AlwaysDepth }),
  };

  private activeDrag: ActiveDrag | null = null;
  private hoveredHandle: GizmoMesh | null = null;
  private selectedScaleHandle: GizmoMesh | null = null;
  private editingAxis: Axis | null = null;
  private editModifiers: { shift: boolean; alt: boolean; ctrl: boolean } | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  // First-person crosshair mode: the pointer is locked, so picking/hover/drag
  // all run off screen centre (0,0) and the drag-start threshold counts locked
  // mouse movement instead of frozen client coordinates.
  private crosshairMode = false;
  private dragMoveAccum = 0;
  // Look-rotation threshold (radians) before a crosshair grab commits to a real
  // transform — keeps a stationary grab+release a no-op click, not an edit.
  private static readonly CROSSHAIR_COMMIT_ANGLE = 0.012;
  private crosshairStartQuat = new THREE.Quaternion();
  private rotateTriggerVisibility: Record<Axis, boolean> = { x: false, y: false, z: false };
  /** When false, rotation trigger handles are suppressed regardless of camera
   *  alignment. Toggled from the viewport action bar. */
  private showRotation = true;
  /** Handle families on offer (see GizmoMode). */
  private mode: GizmoMode = 'all';
  /** When false, the lift cone is hidden (floor-plane moves only). */
  private showLift = true;
  /** When true, holding shift ENGAGES the snap instead of bypassing it (hosts
   *  whose convention is "shift to snap"). */
  private shiftEngagesSnap = false;
  /** When true, only the primary button (left mouse, touch, pen) grabs
   *  handles; other buttons fall through to the host (orbit, context menu). */
  private primaryButtonOnly = false;
  /** Modifier overrides forced on by touch HUD toggles (Uniform / From center /
   *  Ignore snap), OR-ed with the physical shift/alt/ctrl keys during a drag so
   *  the same behaviors are reachable without a keyboard. */
  private forcedMods = { shift: false, alt: false, ctrl: false };

  private snapIncrement = 0;
  /** True only for the synchronous span of a `notifyKeyboardChange` call (an
   *  arrow-key nudge). The transform-commit wiring reads it to treat a keyboard
   *  nudge differently from a pointer drag: a burst of nudges coalesces into one
   *  undo step (sealed on idle) instead of finalizing per keypress. */
  keyboardNudgeActive = false;
  private onTransformStart: GizmoTransformCallback | null = null;
  private onTransformEnd: GizmoTransformCallback | null = null;
  private onObjectChange: GizmoObjectChangeCallback | null = null;
  /** Fired the instant a handle is grabbed (pointerdown), before any drag
   *  threshold, and again on release. Controls uses it to suspend orbit so a
   *  single-finger handle drag never doubles as a camera orbit on touch. */
  private onGrabChange: ((grabbed: boolean) => void) | null = null;

  private handlers: {
    pointerDown: (e: PointerEvent) => void;
    pointerMove: (e: PointerEvent) => void;
    pointerUp: (e: PointerEvent) => void;
    click: (e: MouseEvent) => void;
  };

  constructor(camera: Camera, domElement: HTMLElement) {
    super();
    this.camera = camera;
    this.domElement = domElement;

    this.renderOrder = G.RENDER_ORDER;
    this.add(this.obbGroup);
    this.obbGroup.matrixAutoUpdate = false;

    this.outline = buildOutline(this.mats.outline);
    this.obbGroup.add(this.outline);

    this.floorOutline = buildFloorTranslateRing(this.mats.floor);
    this.obbGroup.add(this.floorOutline);

    this.scaleHandles = buildScaleHandles(this.mats);
    for (const h of this.scaleHandles) this.obbGroup.add(h);

    this.liftHandle = buildLiftHandle(this.mats.lift);
    this.obbGroup.add(this.liftHandle);

    this.sculptHandle = buildSculptHandle(this.mats.sculpt);
    this.obbGroup.add(this.sculptHandle);

    const triggers = buildRotateTriggers(this.mats);
    this.rotateTriggers = { x: triggers.x, y: triggers.y, z: triggers.z };
    this.rotateTriggerArcGeo = triggers.arcGeo;
    this.rotateTriggerRingGeo = triggers.ringGeo;
    this.rotateTriggerGroup.add(this.rotateTriggers.x, this.rotateTriggers.y, this.rotateTriggers.z);
    this.add(this.rotateTriggerGroup);

    this.dimensionLabels = buildDimensionLabels({
      onLabelClick: (axis, modifiers) => this.startLabelEdit(axis, modifiers),
    });
    this.obbGroup.add(this.dimensionLabels.x, this.dimensionLabels.y, this.dimensionLabels.z);

    const dial = buildDialGroup(this.mats);
    this.dialGroup = dial.group;
    this.dialNeedle = dial.needle;
    this.dialReadout = dial.readout;
    this.obbGroup.add(this.dialGroup);
    this.dialGroup.visible = false;

    this.debug = new GizmoDebugOverlay();
    this.add(this.debug);

    this.visible = false;

    this.handlers = {
      pointerDown: this.onPointerDown.bind(this),
      pointerMove: this.onPointerMove.bind(this),
      pointerUp: this.onPointerUp.bind(this),
      click: this.onClickInterceptor.bind(this),
    };
    this.domElement.addEventListener('pointerdown', this.handlers.pointerDown);
    this.domElement.addEventListener('pointermove', this.handlers.pointerMove);
    this.domElement.addEventListener('pointerup', this.handlers.pointerUp);
    // A cancelled touch (scroll handoff, system gesture) must run the same
    // cleanup as pointerup, otherwise the orbit-suspend taken on grab would
    // never be released and the camera would stay frozen.
    this.domElement.addEventListener('pointercancel', this.handlers.pointerUp);
    this.domElement.addEventListener('click', this.handlers.click);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  attach(object: THREE.Object3D, opts?: GizmoAttachOptions): this {
    const optsChanged =
      (opts?.boundsOverride ?? null) !== this.boundsOverride
      || (opts?.allowScale ?? true) !== this.allowScale
      || (opts?.upOverride ?? null) !== this.upOverride;
    if (this.targetObject !== object || optsChanged) {
      this.targetObject = object;
      this.boundsOverride = opts?.boundsOverride ?? null;
      this.allowScale = opts?.allowScale ?? true;
      this.upOverride = opts?.upOverride ?? null;
      // Refresh the ancestor chain once here so the box computation below sees a
      // current matrixWorld (update() does the same at its top; computeOverrideLocalBox
      // no longer refreshes internally, to avoid a double ancestor-walk per frame).
      object.updateWorldMatrix(true, true);
      this.obbBox = this.boundsOverride
        ? this.computeOverrideLocalBox(object)
        : localOBBOf(object);
      this.visible = true;
      this.update();
      this.updateHandleSizes();
    }
    return this;
  }

  /**
   * Convert the world-space override box into the target's LOCAL frame, for the
   * `space === 'local'` OBB path. Falls back to the geometry box when the
   * override returns null or an empty box. (Used by attach + update.)
   */
  private computeOverrideLocalBox(object: THREE.Object3D): THREE.Box3 {
    // The world→local conversion below relies on an ancestor-current matrixWorld.
    // Both callers (attach + update) run updateWorldMatrix(true, true) immediately
    // before invoking this, so we deliberately DON'T refresh again here — doing so
    // doubled the ancestor-walk on every per-frame update() in the override path.
    return worldBoxToLocalBox(this.boundsOverride?.() ?? null, object.matrixWorld)
      ?? localOBBOf(object);
  }

  detach(): void {
    this.endLabelEdit('cancel');
    this.selectedScaleHandle = null;
    this.targetObject = null;
    this.boundsOverride = null;
    this.allowScale = true;
    this.upOverride = null;
    this.visible = false;
    this.dialGroup.visible = false;
  }

  update(): void {
    if (!this.targetObject) return;
    // updateWorldMatrix(true, true) — NOT updateMatrixWorld(true). The latter
    // composes this.matrixWorld = parent.matrixWorld × this.matrix and TRUSTS the
    // ancestor chain to already be current; it never walks up. Right after a
    // rebuild swaps in fresh Object3Ds, a nested node's intermediate-group world
    // matrices are stale until the next full scene render runs updateMatrixWorld
    // on the whole tree. The gizmo's local box is ancestor-independent (localOBBOf
    // cancels the world matrix out), so its SHAPE stays correct — but its world
    // PLACEMENT (obbGroup.matrix = targetObject.matrixWorld, below) composes through
    // those stale ancestors and lands off-center, snapping back only when a camera
    // move triggers a render. updateWorldMatrix(true, …) refreshes the ancestors
    // first so the placement is right on the very first post-rebuild tick.
    this.targetObject.updateWorldMatrix(true, true);
    if (this.space === 'local') {
      // Re-derive the local OBB each tick when overriding so the box follows
      // the target as it moves/rotates (the override is world-space).
      if (this.boundsOverride) this.obbBox = this.computeOverrideLocalBox(this.targetObject);
      this.localBox.copy(this.obbBox);
      this.obbGroup.matrix.copy(this.targetObject.matrixWorld);
    } else if (this.boundsOverride) {
      // World-space override box: place the OBB group at identity (world frame)
      // and use the override box directly. Follows live since the callback reads
      // the target's current bone positions every tick.
      const worldBox = this.boundsOverride();
      if (worldBox && !worldBox.isEmpty()) this.localBox.copy(worldBox);
      else this.localBox.setFromObject(this.targetObject);
      this.obbGroup.matrix.identity();
    } else {
      this.localBox.setFromObject(this.targetObject);
      this.obbGroup.matrix.identity();
    }
    // obbGroup.matrix is the box placement in the gizmo's frame (its parent's
    // frame; the scene in the editor), and every layout / drag computation
    // below reads it — not matrixWorld, which also carries a host's up-axis
    // basis change (TransformGizmo). matrixWorld is only for rendering.
    this.obbGroup.matrixWorldNeedsUpdate = true;
    this.obbGroup.updateMatrixWorld(true);
    layoutScaleHandles(this.scaleHandles, this.localBox, this.outline, this.floorOutline, this.liftHandle);
    this.updateDimensionLabels();
    this.applyCapabilities();
  }

  /**
   * When `allowScale` is false (Bug 5: skeletons), hide every scale handle and
   * dimension label so only floor-translate + lift + rotation arcs remain; the
   * mode and lift switches hide their handle families the same way. Run after
   * any path that re-shows handles (update / updateHandleSizes), and a hidden
   * handle is also un-pickable since hitTest filters on `.visible`.
   */
  private applyCapabilities(): void {
    if (!this.scaleOffered()) {
      for (const h of this.scaleHandles) h.visible = false;
      this.dimensionLabels.x.visible = false;
      this.dimensionLabels.y.visible = false;
      this.dimensionLabels.z.visible = false;
    }
    if (this.mode !== 'all' && this.mode !== 'translate') {
      this.floorOutline.visible = false;
      this.liftHandle.visible = false;
    } else if (!this.showLift) {
      this.liftHandle.visible = false;
    }
  }

  private scaleOffered(): boolean {
    return this.allowScale && (this.mode === 'all' || this.mode === 'scale');
  }

  private rotationOffered(): boolean {
    return this.showRotation && (this.mode === 'all' || this.mode === 'rotate');
  }

  /** Whether scale handles are currently offered (Bug 5 / tests). */
  isScaleAllowed(): boolean { return this.allowScale; }

  setSpace(space: GizmoSpace): void {
    if (this.space === space) return;
    if (this.activeDrag) return;
    this.endLabelEdit('cancel');
    this.selectedScaleHandle = null;
    this.space = space;
    if (this.targetObject) {
      this.update();
      this.updateHandleSizes();
    }
  }

  getSpace(): GizmoSpace { return this.space; }

  /** Offer only one handle family (or 'all', the default). Ignored mid-drag. */
  setMode(mode: GizmoMode): void {
    if (this.mode === mode || this.activeDrag) return;
    this.endLabelEdit('cancel');
    this.selectedScaleHandle = null;
    this.mode = mode;
    this.resetHandleColors();
    this.hoveredHandle = null;
    // Re-show everything, then let update() / updateHandleSizes() re-hide what
    // the new mode (and the camera-dependent layout) doesn't offer.
    this.setBoundingBoxHandlesVisible(true);
    if (this.targetObject) {
      this.update();
      this.updateHandleSizes();
    }
  }

  getMode(): GizmoMode { return this.mode; }

  /** Show/hide the lift cone (vertical move). Hosts that keep objects on a
   *  bed turn it off. */
  setLiftVisible(on: boolean): void {
    if (this.showLift === on) return;
    this.showLift = on;
    this.liftHandle.visible = on;
    this.applyCapabilities();
  }

  /** Make shift engage the snap (true) instead of bypassing it (false, the
   *  editor's default). The touch HUD's "Ignore snap" still bypasses. */
  setShiftEngagesSnap(on: boolean): void { this.shiftEngagesSnap = on; }

  /** Grab handles with the primary button only (see `primaryButtonOnly`). */
  setPrimaryButtonOnly(on: boolean): void { this.primaryButtonOnly = on; }

  /** True from the moment a handle is grabbed (pointerdown) until release. */
  isGrabbed(): boolean { return this.activeDrag !== null; }

  /** Whether a pointer at this position would grab a gizmo handle. Hosts use
   *  it to keep selection / marquee / orbit away from gizmo gestures. */
  hitsHandle(event: { clientX: number; clientY: number }): boolean {
    return this.hitTest(event) !== null;
  }

  updateHandleSizes(): void {
    if (!this.visible || !this.targetObject) return;
    const center = this.localBox.getCenter(new THREE.Vector3()).applyMatrix4(this.obbGroup.matrix);
    const viewportH = this.domElement.getBoundingClientRect().height;
    const pixelWorld = worldUnitsPerPixel(this.camera, center, viewportH);

    this.debug.syncFromGlobalFlag();
    this.debug.showOBB(this.localBox, this.obbGroup.matrix, pixelWorld * G.HANDLE_PX);

    this.rotateTriggerVisibility = this.rotationOffered()
      ? computeRotateTriggerVisibility({
          targetObject: this.targetObject,
          camera: this.camera,
          space: this.space,
        })
      : { x: false, y: false, z: false };

    const inv = this.effectiveInvScale();
    applyVerticalFlip({
      scaleHandles: this.scaleHandles,
      liftHandle: this.liftHandle,
      box: this.localBox,
      cameraBelow: this.isCameraBelowObb(),
      pixelWorld,
      invY: inv.y,
      yRotateVisible: this.rotateTriggerVisibility.y,
      hasActiveDrag: this.activeDrag !== null,
    });

    const ts = getTouchScale();
    const handleScale = pixelWorld * G.HANDLE_PX * ts;
    const liftScale = pixelWorld * G.LIFT_HEIGHT_PX * ts;

    for (const h of this.scaleHandles) {
      h.scale.set(inv.x * handleScale, inv.y * handleScale, inv.z * handleScale);
    }
    this.liftHandle.scale.set(inv.x * handleScale, inv.y * liftScale, inv.z * handleScale);

    layoutRotationTriggers({
      targetObject: this.targetObject,
      rotateTriggers: this.rotateTriggers,
      camera: this.camera,
      viewportHeight: viewportH,
      box: this.localBox,
      obbGroupMatrixWorld: this.obbGroup.matrix,
      space: this.space,
      pixelWorld,
      rotateTriggerVisibility: this.rotateTriggerVisibility,
    });

    this.layoutSculptHandle(pixelWorld, inv, ts, handleScale);
    this.applyCapabilities();
  }

  /** Position + size the "Edit sculpt layer" handle just outside the top-left of
   *  the box (pixel-constant), and show it only when a sculpt-layer target is
   *  set and no drag is in progress. `inv` keeps the pixel offset/size constant
   *  under a non-uniform local-space target scale (matches the scale handles). */
  private layoutSculptHandle(
    pixelWorld: number,
    inv: THREE.Vector3,
    ts: number,
    handleScale: number,
  ): void {
    const visible = this.sculptLayerTargetId !== null && !this.activeDrag;
    this.sculptHandle.visible = visible;
    if (!visible) return;
    const offset = pixelWorld * G.SCULPT_HANDLE_OFFSET_PX * ts;
    const cz = (this.localBox.min.z + this.localBox.max.z) / 2;
    this.sculptHandle.position.set(
      this.localBox.min.x - offset * inv.x,
      this.localBox.max.y + offset * inv.y,
      cz,
    );
    this.sculptHandle.scale.set(
      inv.x * handleScale, inv.y * handleScale, inv.z * handleScale,
    );
  }

  setOnTransformStart(cb: GizmoTransformCallback): void { this.onTransformStart = cb; }
  setOnTransformEnd(cb: GizmoTransformCallback): void { this.onTransformEnd = cb; }
  setOnObjectChange(cb: GizmoObjectChangeCallback): void { this.onObjectChange = cb; }
  setOnGrabChange(cb: (grabbed: boolean) => void): void { this.onGrabChange = cb; }
  setSnapIncrement(n: number): void { this.snapIncrement = n; }

  /** Show/hide the rotation trigger handles (they otherwise appear based on
   *  camera-to-axis alignment). */
  setRotationVisible(on: boolean): void { this.showRotation = on; }
  isRotationVisible(): boolean { return this.showRotation; }

  /** Force drag modifiers on without a keyboard (touch HUD). shift = ignore
   *  snap, alt = scale from center, ctrl = uniform scale. OR-ed with the
   *  physical keys at drag capture. */
  setForcedModifiers(mods: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    this.forcedMods = { ...mods };
  }

  /** Fired when the "Edit sculpt layer" handle is clicked, with the layer
   *  node id to enter. */
  setOnSculptEdit(cb: (nodeId: string) => void): void { this.onSculptEdit = cb; }

  /** Set the sculpt-layer node id the "Edit sculpt layer" handle should target,
   *  or null to hide it. Cheap — the per-frame layout just reads this field. The
   *  Vue layer pushes it on selection / scene change. */
  setSculptLayerTarget(nodeId: string | null): void {
    if (this.sculptLayerTargetId === nodeId) return;
    this.sculptLayerTargetId = nodeId;
    // Reflect immediately so the handle appears/disappears without waiting for
    // the next render tick (also covers the case where nothing else is moving).
    if (this.visible && this.targetObject) this.updateHandleSizes();
  }

  /**
   * Commit a keyboard-driven nudge of the target object as a one-shot
   * "drag": fire dragging-changed(true) → apply the move → objectChange →
   * dragging-changed(false).
   *
   * `applyMove` (when given) performs the actual position change INSIDE this
   * sequence, AFTER the begin event. This ordering is load-bearing for the
   * multi-select proxy: its begin handler (`beginMultiSelectDrag`) snapshots the
   * proxy's matrix as the drag baseline, and the per-node movement is computed
   * as `current − baseline`. If the proxy were moved before begin (the old
   * behaviour), the baseline would already include the move and the delta would
   * be zero — so multi-select keyboard nudges silently did nothing. Single-node
   * targets send an absolute matrix via `onObjectChange`, so the order is
   * harmless there. Callers that already moved the object can omit `applyMove`.
   */
  notifyKeyboardChange(applyMove?: () => void): void {
    if (!this.targetObject || this.activeDrag) return;
    const target = this.targetObject;
    const nodeId = target.userData?.nodeId;
    // Flag the whole synchronous start→change→end span as a keyboard nudge so
    // the commit wiring coalesces a burst rather than finalizing each keypress.
    this.keyboardNudgeActive = true;
    try {
      this.dispatchEvent({ type: 'dragging-changed', value: true });
      if (applyMove) applyMove();
      this.update();
      if (nodeId && this.onObjectChange) {
        this.onObjectChange(nodeId, target.matrix.toArray());
      }
      this.dispatchEvent({ type: 'dragging-changed', value: false });
    } finally {
      this.keyboardNudgeActive = false;
    }
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.handlers.pointerDown);
    this.domElement.removeEventListener('pointermove', this.handlers.pointerMove);
    this.domElement.removeEventListener('pointerup', this.handlers.pointerUp);
    this.domElement.removeEventListener('pointercancel', this.handlers.pointerUp);
    this.domElement.removeEventListener('click', this.handlers.click);
    Object.values(this.mats).forEach((m) => m.dispose());
    this.outline.geometry.dispose();
    for (const h of this.scaleHandles) h.geometry.dispose();
    this.liftHandle.geometry.dispose();
    this.sculptHandle.geometry.dispose();
    this.floorOutline.geometry.dispose();
    this.rotateTriggerArcGeo.dispose();
    this.rotateTriggerRingGeo.dispose();
    [this.dimensionLabels.x, this.dimensionLabels.y, this.dimensionLabels.z, this.dialReadout]
      .forEach((l) => l.element.remove());
    this.debug.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Returns true when the camera is below the OBB center in world space. */
  private isCameraBelowObb(): boolean {
    if (!this.targetObject) return false;
    const centerWorld = this.localBox.getCenter(new THREE.Vector3())
      .applyMatrix4(this.obbGroup.matrix);
    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    return camPos.y < centerWorld.y;
  }

  /** (1,1,1) in world mode; 1/abs(target.scale) in local mode. */
  private effectiveInvScale(): THREE.Vector3 {
    if (this.space === 'world' || !this.targetObject) {
      return new THREE.Vector3(1, 1, 1);
    }
    return this.invTargetScale();
  }

  private updateDimensionLabels(): void {
    if (!this.targetObject) return;
    const camWorld = this.camera.getWorldPosition(new THREE.Vector3());
    const cameraLocal = camWorld.applyMatrix4(new THREE.Matrix4().copy(this.obbGroup.matrix).invert());
    updateDimensionLabelsPart({
      labels: this.dimensionLabels,
      targetObject: this.targetObject,
      box: this.localBox,
      space: this.space,
      effectiveInvScale: this.effectiveInvScale(),
      selectedScaleHandle: this.selectedScaleHandle,
      editingAxis: this.editingAxis,
      cameraLocal,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pointer handling
  // ─────────────────────────────────────────────────────────────────────────

  /** Route all gizmo picking through the screen-centre crosshair while in
   *  first-person (the locked pointer can't address handles directly). */
  setCrosshairMode(on: boolean): void { this.crosshairMode = on; }

  private setNDC(event: { clientX: number; clientY: number }): void {
    if (this.crosshairMode) { this.ndc.set(0, 0); return; }
    const rect = this.domElement.getBoundingClientRect();
    this.ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Block the canvas's bubble-phase click handler from running when the
   *  click landed on a gizmo handle. Without this, Controls.onMouseClick
   *  raycasts the scene's selectable objects (handles are NOT selectable),
   *  finds nothing, and detaches the gizmo — eating our handle selection. */
  private onClickInterceptor(event: MouseEvent): void {
    if (!this.visible || !this.targetObject) return;
    if (this.hitTest(event)) {
      event.stopImmediatePropagation();
      event.stopPropagation();
    }
  }

  private hitTest(event: { clientX: number; clientY: number }): { mesh: GizmoMesh; point: THREE.Vector3 } | null {
    if (!this.visible || !this.targetObject) return null;
    this.setNDC(event);
    setPickRayFromCamera(this.raycaster, this.ndc, this.camera);
    return this.intersectHandles();
  }

  /**
   * Raycast the visible handles with the current raycaster ray. The gizmo works
   * in its PARENT's frame: camera, target and drag math all live there. In the
   * editor that parent is the scene (identity), so this is a plain
   * intersectObjects. A Z-up host (TransformGizmo) parents the gizmo under a
   * fixed basis change, and the handles' matrixWorld include it, so the ray is
   * carried into real world space for the test and the hit point brought back.
   */
  private intersectHandles(): { mesh: GizmoMesh; point: THREE.Vector3 } | null {
    const candidates: THREE.Object3D[] = [
      this.floorOutline,
      ...this.scaleHandles,
      this.liftHandle,
      this.sculptHandle,
      this.rotateTriggers.x, this.rotateTriggers.y, this.rotateTriggers.z,
    ].filter((c) => c.visible);
    const frame = this.parent?.matrixWorld;
    if (!frame || frame.equals(IDENTITY)) {
      const hits = this.raycaster.intersectObjects(candidates, false);
      if (hits.length === 0) return null;
      return { mesh: hits[0].object as GizmoMesh, point: hits[0].point.clone() };
    }
    const frameRay = this.raycaster.ray.clone();
    this.raycaster.ray.applyMatrix4(frame);
    const hits = this.raycaster.intersectObjects(candidates, false);
    this.raycaster.ray.copy(frameRay);
    if (hits.length === 0) return null;
    const inv = new THREE.Matrix4().copy(frame).invert();
    return { mesh: hits[0].object as GizmoMesh, point: hits[0].point.clone().applyMatrix4(inv) };
  }

  /** The drag's "ignore snap" flag (ActiveDrag.shiftKey) from the physical
   *  shift key: shift bypasses the snap, or engages it (setShiftEngagesSnap). */
  private bypassSnap(shift: boolean): boolean {
    return (this.shiftEngagesSnap ? !shift : shift) || this.forcedMods.shift;
  }

  private onPointerDown(event: PointerEvent): void {
    // In first-person, a touch on the canvas is a look-drag (and the nav-pad
    // Action button grabs handles via the crosshair) — so the gizmo ignores
    // touch here. Desktop mouse still grabs directly in crosshair mode.
    if (this.crosshairMode && event.pointerType === 'touch') return;
    if (this.activeDrag) return;
    if (this.primaryButtonOnly && event.button !== 0) return;
    const hit = this.hitTest(event);
    if (!hit || !this.targetObject) {
      this.endLabelEdit('cancel');
      if (this.selectedScaleHandle) {
        this.selectedScaleHandle = null;
        this.updateDimensionLabels();
      }
      return;
    }

    event.preventDefault();
    // Intentionally NOT stopping propagation: OrbitControls listens on the
    // document for pointerup, so swallowing this canvas-level event at the
    // bubble phase leaves a stale entry in its `_pointers` array. On mobile
    // that turns the next single-finger gesture into a (length === 2)
    // DOLLY_PAN. preventDefault is enough to suppress browser gestures and
    // any sibling canvas handler that checks defaultPrevented.
    (this.domElement as HTMLElement).setPointerCapture?.(event.pointerId);

    const drag = this.createDrag(hit, event.pointerId, {
      shift: this.bypassSnap(event.shiftKey),
      alt: event.altKey || this.forcedMods.alt,
      ctrl: event.ctrlKey || event.metaKey || this.forcedMods.ctrl,
    });
    drag.pointerDownX = event.clientX;
    drag.pointerDownY = event.clientY;
    this.activeDrag = drag;
    this.dragMoveAccum = 0;
    // Suspend camera orbit immediately — before the move threshold — so the
    // very first pixels of a handle drag transform the object instead of
    // orbiting when single-finger orbit is the active touch gesture.
    this.onGrabChange?.(true);
  }

  /** Build an ActiveDrag for a hit handle. Assumes the raycaster is already
   *  aimed (hitTest / crosshair aim). Shared by pointer + crosshair grabs. */
  private createDrag(
    hit: { mesh: GizmoMesh; point: THREE.Vector3 },
    pointerId: number,
    mods: { shift: boolean; alt: boolean; ctrl: boolean },
  ): ActiveDrag {
    const target = this.targetObject!;
    target.updateMatrixWorld(true);
    const parentInv = new THREE.Matrix4();
    if (target.parent) {
      target.parent.updateMatrixWorld(true);
      parentInv.copy(target.parent.matrixWorld).invert();
    }
    const role = hit.mesh.userData.role;
    const drag: ActiveDrag = {
      role,
      hitMesh: hit.mesh,
      pointerId,
      pointerDownX: 0,
      pointerDownY: 0,
      movedPastThreshold: false,
      shiftKey: mods.shift,
      altKey: mods.alt,
      ctrlKey: mods.ctrl,
      startScale: target.scale.clone(),
      startPosition: target.position.clone(),
      startQuaternion: target.quaternion.clone(),
      startMatrixWorld: target.matrixWorld.clone(),
      parentInverseWorld: parentInv,
      anchorLocal: new THREE.Vector3(),
      anchorWorld: new THREE.Vector3(),
      startPointerWorld: hit.point.clone(),
      rotateAxisWorld: new THREE.Vector3(),
      rotateOriginWorld: new THREE.Vector3(),
      startRotateAngle: 0,
      currentRotateAngle: 0,
    };

    if (role.kind === 'scale') {
      captureScaleAnchor(this.localBox, this.obbGroup.matrix, drag);
    } else if (role.kind === 'rotate-trigger') {
      const center = this.localBox.getCenter(new THREE.Vector3());
      drag.rotateOriginWorld.copy(center).applyMatrix4(this.obbGroup.matrix);
      const axisVec = new THREE.Vector3(
        role.axis === 'x' ? 1 : 0,
        role.axis === 'y' ? 1 : 0,
        role.axis === 'z' ? 1 : 0,
      );
      worldUnitAxis(axisVec, this.obbGroup.matrix, drag.rotateAxisWorld);

      const initial = intersectRayPlane(this.raycaster.ray, drag.rotateAxisWorld, drag.rotateOriginWorld);
      if (initial) {
        drag.startRotateAngle = signedAngleAroundAxis(initial, drag.rotateOriginWorld, drag.rotateAxisWorld);
      }
    }
    return drag;
  }

  /** Called once when pointer motion crosses CLICK_MOVE_THRESHOLD_PX. Fires
   *  the listener-facing start events and applies any visual drag setup
   *  (rotation: hide bbox + show dial) that we deferred from pointerDown. */
  private commitDrag(drag: ActiveDrag): void {
    drag.movedPastThreshold = true;
    if (drag.role.kind === 'rotate-trigger') {
      this.setBoundingBoxHandlesVisible(false);
      layoutDial(this.dialGroup, this.localBox, drag.role.axis, this.effectiveInvScale());
      this.dialGroup.visible = true;
    }
    this.dispatchEvent({ type: 'dragging-changed', value: true });
    const nodeId = this.targetObject?.userData?.nodeId;
    if (nodeId && this.onTransformStart) this.onTransformStart(nodeId);
  }

  private onPointerMove(event: PointerEvent): void {
    // In FP a crosshair grab is advanced per-frame by the host (updateCrosshairDrag);
    // ignore touch-look moves here so the drag isn't double-driven.
    if (this.crosshairMode && event.pointerType === 'touch') return;
    if (!this.activeDrag) {
      const hit = this.hitTest(event);
      if (hit !== null) {
        if (this.hoveredHandle !== hit.mesh) {
          this.resetHandleColors();
          this.hoveredHandle = hit.mesh;
          this.applyHoverColor(hit.mesh);
          this.dispatchEvent({ type: 'hover-changed' });
        }
      } else if (this.hoveredHandle) {
        this.resetHandleColors();
        this.hoveredHandle = null;
        this.dispatchEvent({ type: 'hover-changed' });
      }
      return;
    }

    // The "Edit sculpt layer" handle is a click-button, not a drag handle: never
    // cross the move threshold, so release always routes to handleClickRelease
    // (a drag would otherwise commit a no-op transform → spurious undo + rebake).
    if (this.activeDrag.role.kind === 'sculpt-edit') return;

    if (!this.activeDrag.movedPastThreshold) {
      // Under the crosshair the client coords are frozen by pointer lock, so
      // accumulate the locked mouse-movement deltas instead.
      let movedSq: number;
      if (this.crosshairMode) {
        this.dragMoveAccum += Math.hypot(event.movementX || 0, event.movementY || 0);
        movedSq = this.dragMoveAccum * this.dragMoveAccum;
      } else {
        const dx = event.clientX - this.activeDrag.pointerDownX;
        const dy = event.clientY - this.activeDrag.pointerDownY;
        movedSq = dx * dx + dy * dy;
      }
      if (movedSq < G.CLICK_MOVE_THRESHOLD_PX * G.CLICK_MOVE_THRESHOLD_PX) return;
      this.commitDrag(this.activeDrag);
    }

    const prevAlt = this.activeDrag.altKey;
    this.activeDrag.shiftKey = this.bypassSnap(event.shiftKey);
    this.activeDrag.altKey = event.altKey || this.forcedMods.alt;
    this.activeDrag.ctrlKey = event.ctrlKey || event.metaKey || this.forcedMods.ctrl;
    if (this.activeDrag.role.kind === 'scale' && prevAlt !== this.activeDrag.altKey) {
      captureScaleAnchor(this.localBox, this.obbGroup.matrix, this.activeDrag);
    }

    event.preventDefault();
    this.applyDrag(event);
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.crosshairMode && event.pointerType === 'touch') return;
    if (!this.activeDrag || event.pointerId !== this.activeDrag.pointerId) return;
    event.preventDefault();
    (this.domElement as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.endActiveDrag();
  }

  /** Finish the active drag (commit or click-release). Split out of onPointerUp
   *  so the first-person crosshair path can release without a pointer event. */
  private endActiveDrag(): void {
    const drag = this.activeDrag;
    if (!drag) return;
    this.activeDrag = null;
    // Release the orbit suspend taken on grab. Runs for both the click-release
    // (tap a handle) and full-drag paths below.
    this.onGrabChange?.(false);

    if (!drag.movedPastThreshold) {
      this.handleClickRelease(drag);
      this.resetHandleColors();
      return;
    }

    const wasRotate = drag.role.kind === 'rotate-trigger';
    const nodeId = this.targetObject?.userData?.nodeId;

    if (wasRotate) {
      this.dialGroup.visible = false;
      this.setBoundingBoxHandlesVisible(true);
    }
    this.resetHandleColors();
    this.debug.hideDragMarkers();

    this.dispatchEvent({ type: 'dragging-changed', value: false });
    if (nodeId && this.onTransformEnd) {
      // A real geometry change landed (we're past the move threshold) — firm
      // tactile confirmation on touch. No-ops on desktop / fine pointers.
      hapticCommit();
      this.onTransformEnd(nodeId);
    }
  }

  // ── First-person crosshair grab/drag/release (mobile Action button) ────────
  // Desktop FP drives the gizmo via its own mouse pointer events (crosshair
  // mode + movement threshold); on touch those are suppressed, so the host
  // drives a grab here, advances it each frame as the player looks, and
  // releases on the next Action tap.

  /** Grab whatever handle sits under the crosshair. Returns true if grabbed —
   *  the host latches its Action button and later calls `endCrosshairDrag`. */
  beginCrosshairDrag(): boolean {
    if (!this.visible || !this.targetObject || this.activeDrag) return false;
    this.ndc.set(0, 0);
    setPickRayFromCamera(this.raycaster, this.ndc, this.camera);
    const hit = this.intersectHandles();
    if (!hit) return false;
    const drag = this.createDrag(hit, -1, { shift: false, alt: false, ctrl: false });
    this.activeDrag = drag;
    this.dragMoveAccum = 0;
    // Don't commit yet. The crosshair has no pixel delta to threshold on, so a
    // bare grab+release (a tap with a handle under the crosshair) would
    // otherwise fire a no-op transform — spurious undo entry + CSG rebake. We
    // defer the start (commitDrag → onTransformStart) until the look actually
    // turns past CROSSHAIR_COMMIT_ANGLE, mirroring the pointer move threshold.
    this.crosshairStartQuat.copy(this.camera.quaternion);
    this.onGrabChange?.(true);
    return true;
  }

  /** Advance the crosshair drag from the camera's current look (call per frame
   *  while a crosshair grab is active). No-op if nothing's grabbed. */
  updateCrosshairDrag(): void {
    if (!this.activeDrag) return;
    // Click-button handle: never commit (release → handleClickRelease).
    if (this.activeDrag.role.kind === 'sculpt-edit') return;
    if (!this.activeDrag.movedPastThreshold) {
      // Wait for a real aim change before starting the transform, so a
      // stationary grab+release commits nothing.
      const turned = this.camera.quaternion.angleTo(this.crosshairStartQuat);
      if (turned < EditGizmo.CROSSHAIR_COMMIT_ANGLE) return;
      this.commitDrag(this.activeDrag);
    }
    this.ndc.set(0, 0);
    setPickRayFromCamera(this.raycaster, this.ndc, this.camera);
    this.applyActiveDrag();
  }

  /** Release a crosshair grab (commits the transform). */
  endCrosshairDrag(): void {
    if (this.activeDrag) this.endActiveDrag();
  }

  private handleClickRelease(drag: ActiveDrag): void {
    this.endLabelEdit('cancel');
    if (drag.role.kind === 'sculpt-edit') {
      this.selectedScaleHandle = null;
      this.updateDimensionLabels();
      const targetId = this.sculptLayerTargetId;
      if (targetId && this.onSculptEdit) this.onSculptEdit(targetId);
      return;
    }
    if (drag.role.kind === 'scale') {
      const sameHandle = this.selectedScaleHandle === drag.hitMesh;
      this.selectedScaleHandle = sameHandle ? null : drag.hitMesh;
    } else {
      this.selectedScaleHandle = null;
    }
    this.updateDimensionLabels();
  }

  private startLabelEdit(
    axis: Axis,
    modifiers: { shift: boolean; alt: boolean; ctrl: boolean } = { shift: false, alt: false, ctrl: false },
  ): void {
    // With a handle selected, only the axes that handle scales are editable
    // (its perpendicular face dimensions are fixed by it). Without one, any
    // axis can be edited — the resize anchors at the box center.
    if (this.selectedScaleHandle) {
      const role = this.selectedScaleHandle.userData.role;
      if (role.kind !== 'scale' || role.scaleSigns[axis] === 0) return;
    }
    if (this.editingAxis && this.editingAxis !== axis) this.endLabelEdit('cancel');
    if (this.editingAxis === axis) return;

    this.editingAxis = axis;
    this.editModifiers = modifiers;
    startLabelEditPart({
      axis,
      modifiers,
      labels: this.dimensionLabels,
      startWorldLength: this.currentDisplayedLength(axis),
      onCommit: () => this.endLabelEdit('commit'),
      onCancel: () => this.endLabelEdit('cancel'),
    });
  }

  private endLabelEdit(mode: 'commit' | 'cancel'): void {
    const axis = this.editingAxis;
    if (!axis) return;
    this.editingAxis = null;
    const modifiers = this.editModifiers ?? { shift: false, alt: false, ctrl: false };
    this.editModifiers = null;
    const newValue = endLabelEditPart(this.dimensionLabels, axis, mode, this.currentDisplayedLength(axis));
    if (newValue !== null) {
      this.applyDimensionEdit(this.selectedScaleHandle, axis, newValue, modifiers);
    }
  }

  /** Current "displayed" world-extent along `axis` — matches what the label
   *  text shows. Used both as the input seed and as the starting extent for
   *  the scale-factor math. */
  private currentDisplayedLength(axis: Axis): number {
    if (!this.targetObject) return 0;
    const box = this.localBox;
    if (this.space === 'local') {
      const ws = this.targetObject.getWorldScale(new THREE.Vector3());
      const scaleAxis = axis === 'x' ? ws.x : axis === 'y' ? ws.y : ws.z;
      return (box.max[axis] - box.min[axis]) * Math.abs(scaleAxis);
    }
    return box.max[axis] - box.min[axis];
  }

  /** Apply a label-driven dimension change. Mirrors a held-modifier drag:
   *  ALT anchors at the OBB center ("scale from center"), CTRL applies the
   *  factor uniformly to all three local axes, SHIFT is a no-op here (the
   *  typed value is already exact — there's no snap to bypass).
   *
   *  `handle` may be null when editing a default dimension label before any
   *  scale handle has been clicked; in that case the anchor is the OBB center
   *  unconditionally (no side bias to choose from). */
  applyDimensionEdit(
    handle: GizmoMesh | null,
    axis: Axis,
    newLength: number,
    modifiers: { shift: boolean; alt: boolean; ctrl: boolean } = { shift: false, alt: false, ctrl: false },
  ): void {
    if (!this.targetObject) return;
    const role = handle?.userData.role;
    const scaleSigns = role?.kind === 'scale' ? role.scaleSigns : null;
    if (handle && (!scaleSigns || scaleSigns[axis] === 0)) return;
    const useCenter = modifiers.alt || !scaleSigns;
    const target = this.targetObject;
    target.updateMatrixWorld(true);

    const startScale = target.scale.clone();
    const startPosition = target.position.clone();

    const startDisplayedLength = this.currentDisplayedLength(axis);
    if (startDisplayedLength < 1e-9) return;
    const wantedLength = Math.max(G.MIN_WORLD_DIMENSION, newLength);
    const factor = wantedLength / startDisplayedLength;

    let localAxis: Axis = axis;
    if (this.space === 'world') {
      const worldDir = new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0,
      );
      const lx = worldUnitAxis(new THREE.Vector3(1, 0, 0), target.matrixWorld);
      const ly = worldUnitAxis(new THREE.Vector3(0, 1, 0), target.matrixWorld);
      const lz = worldUnitAxis(new THREE.Vector3(0, 0, 1), target.matrixWorld);
      const ax = Math.abs(lx.dot(worldDir));
      const ay = Math.abs(ly.dot(worldDir));
      const az = Math.abs(lz.dot(worldDir));
      localAxis = (ax >= ay && ax >= az) ? 'x' : (ay >= az ? 'y' : 'z');
    }

    const newScale = startScale.clone();
    if (modifiers.ctrl) {
      newScale.x = factor * startScale.x;
      newScale.y = factor * startScale.y;
      newScale.z = factor * startScale.z;
    } else {
      newScale[localAxis] = factor * startScale[localAxis];
    }

    const anchorLocal = new THREE.Vector3();
    if (useCenter) {
      this.localBox.getCenter(anchorLocal);
    } else {
      boxScaleAnchor(this.localBox, scaleSigns!, anchorLocal);
    }
    const anchorWorld = anchorLocal.clone().applyMatrix4(this.obbGroup.matrix);

    const parentInverseWorld = new THREE.Matrix4();
    if (target.parent) {
      target.parent.updateMatrixWorld(true);
      parentInverseWorld.copy(target.parent.matrixWorld).invert();
    }

    const nodeId = target.userData?.nodeId;
    this.dispatchEvent({ type: 'dragging-changed', value: true });

    target.scale.copy(newScale);
    target.position.copy(startPosition);
    target.updateMatrixWorld(true);

    const newAnchorWorld = currentScaleAnchorWorld(
      target,
      this.space,
      scaleSigns ?? new THREE.Vector3(),
      anchorLocal,
      useCenter,
    );
    const correctionWorld = anchorWorld.clone().sub(newAnchorWorld);
    target.position.add(worldDeltaToParentLocal(correctionWorld, parentInverseWorld));

    target.updateMatrix();
    target.updateMatrixWorld(true);
    this.update();
    this.updateHandleSizes();
    if (nodeId && this.onObjectChange) {
      this.onObjectChange(nodeId, target.matrix.toArray());
    }
    this.dispatchEvent({ type: 'dragging-changed', value: false });
  }

  private setBoundingBoxHandlesVisible(v: boolean): void {
    for (const h of this.scaleHandles) h.visible = v;
    this.liftHandle.visible = v;
    this.sculptHandle.visible = v && this.sculptLayerTargetId !== null;
    this.floorOutline.visible = v;
    this.outline.visible = v;
    this.rotateTriggerGroup.visible = v;
    this.dimensionLabels.x.visible = v;
    this.dimensionLabels.y.visible = v;
    this.dimensionLabels.z.visible = v;
    if (v) this.applyCapabilities();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Drag application
  // ─────────────────────────────────────────────────────────────────────────

  private dragContext(): DragContext {
    const up = this.upOverride?.();
    return {
      targetObject: this.targetObject!,
      camera: this.camera,
      raycaster: this.raycaster,
      localBox: this.localBox,
      obbBox: this.obbBox,
      obbGroupMatrixWorld: this.obbGroup.matrix,
      space: this.space,
      snapIncrement: this.snapIncrement,
      up: up && up.lengthSq() > 1e-12 ? up.clone().normalize() : worldUpThree(),
    };
  }

  private applyDrag(event: PointerEvent): void {
    if (!this.activeDrag || !this.targetObject) return;
    this.setNDC(event);
    setPickRayFromCamera(this.raycaster, this.ndc, this.camera);
    this.applyActiveDrag();
  }

  /** Apply the active drag from the CURRENT raycaster ray (caller aims it).
   *  Split out of applyDrag so the first-person crosshair path can drive the
   *  same drag from the screen-centre ray each frame. */
  private applyActiveDrag(): void {
    if (!this.activeDrag || !this.targetObject) return;
    const drag = this.activeDrag;
    const target = this.targetObject;
    const ctx = this.dragContext();
    const publishDebug = (info: { anchorWorld: THREE.Vector3; startWorld: THREE.Vector3; currentWorld: THREE.Vector3 }) => {
      this.publishDebugDragMarkers(info.anchorWorld, info.startWorld, info.currentWorld);
    };

    if (drag.role.kind === 'scale') applyScaleDrag(ctx, drag, publishDebug);
    else if (drag.role.kind === 'translate-floor') applyFloorTranslate(ctx, drag);
    else if (drag.role.kind === 'lift') applyLiftDrag(ctx, drag);
    else if (drag.role.kind === 'rotate-trigger') applyRotateDrag(ctx, drag, publishDebug);

    target.updateMatrix();
    target.updateMatrixWorld(true);
    this.update();
    this.updateHandleSizes();

    if (drag.role.kind === 'rotate-trigger') {
      layoutDial(this.dialGroup, this.localBox, drag.role.axis, this.effectiveInvScale());
      updateDialNeedle(this.dialNeedle, this.dialReadout, drag.currentRotateAngle - drag.startRotateAngle);
    }

    const nodeId = target.userData?.nodeId;
    if (nodeId && this.onObjectChange) {
      this.onObjectChange(nodeId, target.matrix.toArray());
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private invTargetScale(): THREE.Vector3 {
    const ts = this.targetObject!.scale;
    return new THREE.Vector3(
      ts.x !== 0 ? 1 / Math.abs(ts.x) : 1,
      ts.y !== 0 ? 1 / Math.abs(ts.y) : 1,
      ts.z !== 0 ? 1 / Math.abs(ts.z) : 1,
    );
  }

  /**
   * Push the current drag's anchor/start/current points into the debug overlay
   * (no-op when the global debug flag is off). The overlay sits in world space,
   * so we just hand it world-space points.
   */
  private publishDebugDragMarkers(
    anchorWorld: THREE.Vector3,
    startWorld: THREE.Vector3,
    currentWorld: THREE.Vector3,
  ): void {
    if (!GizmoDebugOverlay.isEnabled() || !this.targetObject) return;
    const center = this.localBox.getCenter(new THREE.Vector3()).applyMatrix4(this.targetObject.matrixWorld);
    const viewportH = this.domElement.getBoundingClientRect().height;
    const px = worldUnitsPerPixel(this.camera, center, viewportH) * G.HANDLE_PX;
    this.debug.showAnchor(anchorWorld, px);
    this.debug.showStartPoint(startWorld, px);
    this.debug.showCurrentPoint(currentWorld, px);
  }

  private applyHoverColor(handle: GizmoMesh): void {
    const role = handle.userData.role;
    const mat = handle.material as THREE.MeshBasicMaterial;
    if (role.kind === 'scale') mat.color.setHex(G.HANDLE_HOVER);
    else if (role.kind === 'lift') mat.color.setHex(G.HANDLE_HOVER);
    else if (role.kind === 'translate-floor') {
      mat.color.setHex(G.TRANSLATE_FLOOR_HOVER);
      mat.opacity = 0.15;
    } else if (role.kind === 'rotate-trigger') {
      mat.color.setHex(G.HANDLE_HOVER);
    } else if (role.kind === 'sculpt-edit') {
      mat.color.setHex(G.SCULPT_HANDLE_HOVER);
    }
  }

  private resetHandleColors(): void {
    for (const h of this.scaleHandles) {
      (h.material as THREE.MeshBasicMaterial).color.setHex(G.HANDLE_FILL);
    }
    (this.liftHandle.material as THREE.MeshBasicMaterial).color.setHex(G.LIFT_COLOR);
    (this.floorOutline.material as THREE.MeshBasicMaterial).color.setHex(G.TRANSLATE_FLOOR_COLOR);
    (this.floorOutline.material as THREE.MeshBasicMaterial).opacity = 0;
    (this.rotateTriggers.x.material as THREE.MeshBasicMaterial).color.setHex(G.ROTATE_COLOR);
    (this.rotateTriggers.y.material as THREE.MeshBasicMaterial).color.setHex(G.ROTATE_COLOR);
    (this.rotateTriggers.z.material as THREE.MeshBasicMaterial).color.setHex(G.ROTATE_COLOR);
    (this.sculptHandle.material as THREE.MeshBasicMaterial).color.setHex(G.SCULPT_HANDLE_COLOR);
  }
}
