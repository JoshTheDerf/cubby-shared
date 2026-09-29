import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewportGizmo } from 'three-viewport-gizmo';
import { viewCubeThemeOptions, type CubePalettes } from './viewCubeTheme';
import { CameraProjection, type CameraType } from './projection';

/**
 * Camera + orbit + gizmo plumbing shared by the voxel and slicer
 * viewports. Owns:
 *
 *   - matched perspective/orthographic camera pair with a position-,
 *     rotation-, and target-preserving swap
 *   - OrbitControls + caller-supplied mouse-button and touch wiring
 *   - ViewportGizmo (cube), attached to controls and re-attached on swap
 *   - ResizeObserver that drives camera aspect, renderer size, gizmo
 *   - RAF loop with a caller-supplied render callback (the slicer's
 *     dirty-flag optimization stays in the callback rather than baked
 *     in here)
 *
 * Not owned: scene graph, lights, scene background, raycasting,
 * picking, post-render passes. Those stay caller-controlled — the
 * voxel and slicer viewports have meaningfully different lighting and
 * pixel-ratio policies and we want to keep that explicit.
 *
 * CubbyCAD's main 3D editor (`core/Scene.ts` + `core/Controls.ts`) has its
 * own more complex setup with marquee selection, transform controls, label
 * renderer, etc. — that path only shares the CameraProjection pair.
 */

export interface ViewportCameraRigOptions {
  /** DOM element the gizmo and resize observer hook into. */
  container: HTMLElement;
  /** Pre-built scene the rig renders. Caller owns lights + content. */
  scene: THREE.Scene;
  /** Renderer config; defaults are `{ antialias: true, alpha: true }`. */
  rendererOptions?: THREE.WebGLRendererParameters;
  /** Pixel-ratio strategy. 'capped' = min(devicePixelRatio, 2),
   *  'unclamped' = devicePixelRatio. Default 'capped'. */
  pixelRatio?: 'capped' | 'unclamped';
  /** Perspective camera params. FOV defaults to 45° (matches voxel +
   *  slicer); near 0.1, far 10000. */
  perspective?: { fov?: number; near?: number; far?: number };
  /** Ortho frustum half-height (world units). Default 150. The
   *  rig keeps the aspect-scaled left/right in sync with the
   *  container size on every resize. */
  orthographicFrustumSize?: number;
  /** Ortho near/far. Defaults to ±10000 so a generous CAD-scale world
   *  doesn't clip behind the camera. */
  orthographic?: { near?: number; far?: number };
  /** Initial camera position. Default (60, 50, 60). */
  initialPosition?: THREE.Vector3;
  /** Initial OrbitControls target. Default (0, 0, 0). */
  initialTarget?: THREE.Vector3;
  /** Default starting camera type. Default 'perspective'. */
  initialCameraType?: CameraType;
  /** Mouse-button mappings on the OrbitControls. Defaults are unchanged
   *  three.js defaults (LEFT=ROTATE, MIDDLE=DOLLY, RIGHT=PAN). The voxel
   *  viewer overrides LEFT to null (tool painting steals it). */
  mouseButtons?: Partial<{
    LEFT: THREE.MOUSE | null;
    MIDDLE: THREE.MOUSE | null;
    RIGHT: THREE.MOUSE | null;
  }>;
  /** Damping factor for OrbitControls; default 0.08 (matches existing). */
  dampingFactor?: number;
  /** Gizmo overrides; defaults `type:'cube', size:96, placement:'top-right'`. */
  gizmoOptions?: ConstructorParameters<typeof ViewportGizmo>[2];
  /** Called every resize after camera/renderer/gizmo are updated. Useful
   *  for callers that need to refresh LineMaterial resolution etc. */
  onResize?: (width: number, height: number) => void;
  /** Called whenever the camera instance changes (e.g. on type swap).
   *  Use this to re-bind any picker/raycaster that captured the old
   *  camera reference. */
  onCameraChange?: (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) => void;
  /** Called whenever the gizmo instance is (re)created — once at boot
   *  and again after every hidden → visible transition. The rig
   *  disposes + rebuilds the gizmo on the transition because
   *  three-viewport-gizmo holds stale viewport state when its canvas
   *  was display:none, leaving the cube widget blank on re-show.
   *  Callers re-attach their `start`/`change`/`end` listeners here. */
  onGizmoCreated?: (gizmo: ViewportGizmo) => void;
  /** Colour mode for the cube. Default: always light. */
  theme?: { isDark(): boolean; onChange(cb: (dark: boolean) => void): () => void };
  /** Cube colours. Default CUBBY_CUBE_PALETTES. */
  palette?: CubePalettes;
}

export class ViewportCameraRig {
  readonly renderer: THREE.WebGLRenderer;
  readonly perspectiveCamera: THREE.PerspectiveCamera;
  readonly orthographicCamera: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  // `gizmo` is replaced on hidden → visible transitions — declared
  // mutable so the rig can swap it in `rebuildGizmo()`. Callers that
  // need a live reference subscribe via `onGizmoCreated`.
  gizmo: ViewportGizmo;
  readonly scene: THREE.Scene;
  readonly container: HTMLElement;

  private readonly projection: CameraProjection;
  private readonly palette?: CubePalettes;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrame = 0;
  private animating = false;
  private onResizeCb?: (w: number, h: number) => void;
  private onCameraChangeCb?: (camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) => void;
  private onGizmoCreatedCb?: (gizmo: ViewportGizmo) => void;
  private gizmoCtorOptions: ConstructorParameters<typeof ViewportGizmo>[2];
  /** Caller overrides, re-merged over the theme colours on every rebuild. */
  private gizmoUserOptions: NonNullable<ConstructorParameters<typeof ViewportGizmo>[2]>;
  private unsubscribeTheme: (() => void) | null = null;
  // Hidden in first-person (the host toggles this). Skipping the gizmo's
  // scissor render lets the full-frame scene render clear that corner, and
  // `enabled=false` stops it intercepting crosshair input.
  private gizmoVisible = true;

  constructor(opts: ViewportCameraRigOptions) {
    this.container = opts.container;
    this.scene = opts.scene;
    this.onResizeCb = opts.onResize;
    this.onCameraChangeCb = opts.onCameraChange;
    this.onGizmoCreatedCb = opts.onGizmoCreated;
    this.palette = opts.palette;

    const rect = opts.container.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true,
      ...(opts.rendererOptions ?? {}),
    });
    const dpr = opts.pixelRatio === 'unclamped'
      ? window.devicePixelRatio
      : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    // updateStyle=true: set the canvas CSS size to the logical (w,h). Without
    // it the canvas — a replaced element — sizes to its dpr-scaled backing
    // buffer and overflows the container on HiDPI, so the container centre (the
    // FP crosshair) no longer matches ndc (0,0) (the canvas centre). That was
    // the "preview offset down-right" in first-person.
    this.renderer.setSize(w, h, true);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    opts.container.appendChild(this.renderer.domElement);

    const persp = opts.perspective ?? {};
    const ortho = opts.orthographic ?? {};
    this.projection = new CameraProjection({
      perspective: { fov: persp.fov ?? 45, near: persp.near ?? 0.1, far: persp.far ?? 10000 },
      frustumSize: opts.orthographicFrustumSize ?? 150,
      orthographic: { near: ortho.near ?? -10000, far: ortho.far ?? 10000 },
      initialType: opts.initialCameraType ?? 'perspective',
      // Historic behaviour: the swap keeps pose + target, not the zoom.
      matchScale: false,
    });
    this.perspectiveCamera = this.projection.perspective;
    this.orthographicCamera = this.projection.orthographic;
    this.projection.resize(w, h);
    const initPos = opts.initialPosition ?? new THREE.Vector3(60, 50, 60);
    this.perspectiveCamera.position.copy(initPos);
    this.orthographicCamera.position.copy(initPos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = opts.dampingFactor ?? 0.08;
    if (opts.initialTarget) this.controls.target.copy(opts.initialTarget);
    // Map the partial button overrides onto the controls' button map.
    // Passing null for a button disables that button on the controls.
    if (opts.mouseButtons) {
      const m = this.controls.mouseButtons as unknown as Record<string, THREE.MOUSE | null>;
      if (opts.mouseButtons.LEFT !== undefined) m.LEFT = opts.mouseButtons.LEFT;
      if (opts.mouseButtons.MIDDLE !== undefined) m.MIDDLE = opts.mouseButtons.MIDDLE;
      if (opts.mouseButtons.RIGHT !== undefined) m.RIGHT = opts.mouseButtons.RIGHT;
    }

    this.gizmoUserOptions = {
      container: opts.container,
      type: 'cube' as const,
      size: 96,
      placement: 'top-right' as const,
      // Inset from the corner so the cube clears the top viewport chrome.
      offset: { top: 12, right: 12 },
      ...(opts.gizmoOptions ?? {}),
    };
    this.gizmoCtorOptions = this.themedGizmoOptions(opts.theme?.isDark() ?? false);
    this.gizmo = new ViewportGizmo(this.camera, this.renderer, this.gizmoCtorOptions);
    this.gizmo.attachControls(this.controls);
    this.wireGizmoActivityBridge();
    this.onGizmoCreatedCb?.(this.gizmo);
    // The cube's colours are constructor-only: a colour-mode flip rebuilds it.
    this.unsubscribeTheme = opts.theme?.onChange((dark) => {
      this.gizmoCtorOptions = this.themedGizmoOptions(dark);
      this.rebuildGizmo();
    }) ?? null;

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(opts.container);
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera { return this.projection.camera; }
  get cameraType(): CameraType { return this.projection.type; }

  /**
   * Swap perspective ↔ orthographic, preserving position, rotation, and
   * OrbitControls target so the user keeps their framing across the
   * switch. Bumps the gizmo's camera reference too — without that the
   * cube widget keeps animating against the dead camera.
   */
  setCameraType(type: CameraType): void {
    if (this.projection.type === type) return;
    const next = this.projection.setType(type, { controls: this.controls });

    // ViewportGizmo's API exposes camera via property; reassign so the
    // cube re-tracks the live camera. Some versions also need a fresh
    // attachControls call to re-bind the controls' camera ref.
    (this.gizmo as unknown as { camera: THREE.Camera }).camera = next;
    this.gizmo.attachControls(this.controls);

    this.onCameraChangeCb?.(next);
  }

  /**
   * Snap the camera to a world-axis-aligned view. Mirrors the main
   * editor's `Controls.setView` so the keyboard shortcuts (Numpad 1/3/7
   * + Ctrl variants) feel identical across workbenches. Preserves the
   * orbit target and camera-to-target distance — only the direction
   * changes — and restores `camera.up` to world up so subsequent orbits
   * keep the world Y-up.
   */
  setView(direction: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'): void {
    const target = this.controls.target;
    const distance = Math.max(this.camera.position.distanceTo(target), 1);
    const worldUp = new THREE.Vector3(0, 1, 0);
    let offset: THREE.Vector3;
    let lookUp: THREE.Vector3;
    switch (direction) {
      case 'front':  offset = new THREE.Vector3(0, 0,  1); lookUp = worldUp.clone(); break;
      case 'back':   offset = new THREE.Vector3(0, 0, -1); lookUp = worldUp.clone(); break;
      case 'right':  offset = new THREE.Vector3( 1, 0, 0); lookUp = worldUp.clone(); break;
      case 'left':   offset = new THREE.Vector3(-1, 0, 0); lookUp = worldUp.clone(); break;
      case 'top':    offset = new THREE.Vector3(0,  1, 0); lookUp = new THREE.Vector3(0, 0, -1); break;
      case 'bottom': offset = new THREE.Vector3(0, -1, 0); lookUp = new THREE.Vector3(0, 0,  1); break;
    }
    this.camera.up.copy(lookUp);
    this.camera.position.copy(target).addScaledVector(offset, distance);
    this.camera.lookAt(target);
    this.camera.up.copy(worldUp);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    // Render-on-demand parity with the main editor (Controls.setView): a
    // programmatic pose set doesn't reliably emit OrbitControls' 'change', so an
    // idle-paused consumer (renderFn returning false until woken) never repaints
    // the new view. Emit it so the consumer's controls-'change' activity hook
    // fires now.
    this.controls.dispatchEvent({ type: 'change' });
  }

  /**
   * Start a RAF loop driving controls + render + gizmo. The rig parks
   * itself completely when the container is offscreen (display:none
   * via a `v-show`-ed workbench tab, for example) — no controls.update,
   * no gizmo render, no caller render. When visible, the gizmo always
   * renders (cheap scissor pass; keeps the cube widget on screen even
   * during idle frames where the caller's main scene is dirty-flag
   * skipping). `renderFn`'s return is informational; the gizmo runs
   * either way as long as the viewport is visible.
   */
  startAnimation(renderFn: () => boolean | void): void {
    if (this.animating) return;
    this.animating = true;
    let wasVisible = false;
    const tick = () => {
      if (!this.animating) return;
      this.animationFrame = requestAnimationFrame(tick);
      const visible = this.container.offsetParent !== null;
      if (!visible) { wasVisible = false; return; }
      // Hidden → visible transition: the canvas may have been
      // resized or discarded its draw buffer while display:none.
      // Re-measure (gizmo + caller) and signal the caller so any
      // dirty-flag rendering paints the first frame back instead of
      // showing a stale / blank canvas until the user resizes the
      // window.
      if (!wasVisible) {
        // three-viewport-gizmo caches viewport dimensions on construction
        // and doesn't recover cleanly from a display:none → display:block
        // round-trip — the cube renders blank until the user resizes the
        // window. Disposing + recreating is the only reliable repaint.
        this.rebuildGizmo();
        this.handleResize();
        wasVisible = true;
      }
      this.controls.update();
      // `renderFn` returns false on a paused (idle) frame; skip the gizmo render
      // too so a paused frame does zero GPU work (render-on-demand). controls
      // still update each tick (cheap, keeps damping/inertia correct).
      const rendered = renderFn();
      // Hidden in first-person: skip the scissor pass so the full-frame scene
      // render leaves that corner clear.
      if (rendered !== false && this.gizmoVisible) this.gizmo.render();
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  /** Show/hide the view-cube gizmo (the host hides it in first-person). */
  setGizmoVisible(visible: boolean): void {
    this.gizmoVisible = visible;
    this.gizmo.enabled = visible;
  }

  /** Theme colours first, caller overrides on top (so a host can still pin
   *  a face colour regardless of mode). */
  private themedGizmoOptions(dark: boolean): ConstructorParameters<typeof ViewportGizmo>[2] {
    return { ...viewCubeThemeOptions(dark, { palette: this.palette }), ...this.gizmoUserOptions };
  }

  /** Tear down the current gizmo and construct a fresh one with the
   *  same options. Called by the visibility-transition path in the
   *  RAF tick; the lifecycle callback fires so listeners attached to
   *  the previous instance can be re-bound. */
  private rebuildGizmo(): void {
    try { this.gizmo.dispose(); } catch (err) { console.warn('ViewportGizmo dispose failed:', err); }
    this.gizmo = new ViewportGizmo(this.camera, this.renderer, this.gizmoCtorOptions);
    this.gizmo.attachControls(this.controls);
    this.gizmo.enabled = this.gizmoVisible;
    this.wireGizmoActivityBridge();
    this.onGizmoCreatedCb?.(this.gizmo);
  }

  /**
   * The view-cube animates the camera INSIDE the gizmo library, dispatching its
   * 'start'/'change'/'end' on the GIZMO — never on OrbitControls. Consumers wake
   * their render loop on OrbitControls 'change', and the camera only advances
   * when `gizmo.render()` runs (skipped on a paused frame), so without this a
   * face-click reorient stalls until the next real camera input. Bridge the
   * gizmo events to a controls 'change' to wake the consumer and pump the
   * animation through to its settled pose. Re-called whenever the gizmo is
   * recreated (`rebuildGizmo`); the old gizmo is disposed, dropping its listener.
   */
  private wireGizmoActivityBridge(): void {
    const bump = () => this.controls.dispatchEvent({ type: 'change' });
    this.gizmo.addEventListener('start', bump);
    this.gizmo.addEventListener('change', bump);
    this.gizmo.addEventListener('end', bump);
  }

  stopAnimation(): void {
    this.animating = false;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);

    this.projection.resize(w, h);

    this.renderer.setSize(w, h, true); // keep canvas CSS size = logical size (see ctor)
    this.gizmo.update();
    this.onResizeCb?.(w, h);
  }

  dispose(): void {
    this.stopAnimation();
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls.dispose();
    // ViewportGizmo doesn't expose a dispose; reattach to a throw-away
    // controls instance and let GC reclaim the DOM children when the
    // host removes the renderer's canvas.
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
