import * as THREE from 'three';

/**
 * Perspective + orthographic camera pair with a pose-preserving switch — the
 * projection toggle both apps offer.
 *
 * The orthographic camera's frustum is `frustumSize` tall at zoom 1 and kept
 * aspect-correct by `resize()`. Switching copies position + orientation, so
 * the view direction and orbit target stay put; with `matchScale` (default)
 * it also keeps the apparent size at the orbit target: perspective → ortho
 * sets the ortho zoom from the camera distance and FOV, ortho → perspective
 * moves the camera to the distance that shows the same height. Hosts re-point
 * whatever holds the camera (OrbitControls, a view cube, pickers) through the
 * returned camera or `onChange`.
 */

export type CameraType = 'perspective' | 'orthographic';
export type AnyCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export interface CameraProjectionOptions {
  /** Use this perspective camera (else one is created from `perspective`). */
  perspectiveCamera?: THREE.PerspectiveCamera;
  perspective?: { fov?: number; near?: number; far?: number };
  /** Ortho frustum height (world units) at zoom 1. Default 150. */
  frustumSize?: number;
  /** Ortho near/far. Default ±20000 so a CAD-scale world behind the camera
   *  position doesn't clip (a parallel projection has no reason to). */
  orthographic?: { near?: number; far?: number };
  initialType?: CameraType;
  /** Keep the apparent size at the orbit target across a switch. Default true. */
  matchScale?: boolean;
  onChange?: (camera: AnyCamera, type: CameraType) => void;
}

/** Anything with an orbit target that follows the active camera (OrbitControls). */
export interface OrbitLike {
  object: THREE.Object3D;
  target: THREE.Vector3;
  update(): unknown;
}

export class CameraProjection {
  readonly perspective: THREE.PerspectiveCamera;
  readonly orthographic: THREE.OrthographicCamera;
  readonly frustumSize: number;
  private active: AnyCamera;
  private kind: CameraType;
  private readonly matchScale: boolean;
  private readonly onChange?: (camera: AnyCamera, type: CameraType) => void;

  constructor(opts: CameraProjectionOptions = {}) {
    const p = opts.perspective ?? {};
    this.perspective = opts.perspectiveCamera
      ?? new THREE.PerspectiveCamera(p.fov ?? 45, 1, p.near ?? 0.1, p.far ?? 10000);
    this.frustumSize = opts.frustumSize ?? 150;
    const o = opts.orthographic ?? {};
    const half = this.frustumSize / 2;
    this.orthographic = new THREE.OrthographicCamera(-half, half, half, -half, o.near ?? -20000, o.far ?? 20000);
    this.orthographic.up.copy(this.perspective.up);
    this.orthographic.position.copy(this.perspective.position);
    this.orthographic.quaternion.copy(this.perspective.quaternion);
    this.matchScale = opts.matchScale ?? true;
    this.onChange = opts.onChange;
    this.kind = opts.initialType ?? 'perspective';
    this.active = this.kind === 'perspective' ? this.perspective : this.orthographic;
  }

  get camera(): AnyCamera { return this.active; }
  get type(): CameraType { return this.kind; }

  /** Keep both cameras' aspect in step with the viewport. */
  resize(width: number, height: number): void {
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const half = this.frustumSize / 2;
    this.orthographic.left = -half * aspect;
    this.orthographic.right = half * aspect;
    this.orthographic.top = half;
    this.orthographic.bottom = -half;
    this.orthographic.updateProjectionMatrix();
  }

  /**
   * Switch projection. `target` is the orbit centre (required for
   * `matchScale`); with `controls`, its camera is re-pointed and its target
   * kept. Returns the now-active camera.
   */
  setType(type: CameraType, opts: { target?: THREE.Vector3; controls?: OrbitLike } = {}): AnyCamera {
    if (type === this.kind) return this.active;
    const from = this.active;
    const to = type === 'perspective' ? this.perspective : this.orthographic;
    const target = (opts.target ?? opts.controls?.target)?.clone();
    to.up.copy(from.up);
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    if (this.matchScale && target) {
      const tan = Math.tan(THREE.MathUtils.degToRad(this.perspective.fov) / 2);
      if (to === this.orthographic) {
        const d = Math.max(from.position.distanceTo(target), 1e-6);
        this.orthographic.zoom = this.frustumSize / (2 * d * tan);
      } else {
        const visible = this.frustumSize / this.orthographic.zoom;
        const dir = from.position.clone().sub(target);
        if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1).applyQuaternion(from.quaternion);
        to.position.copy(target).addScaledVector(dir.normalize(), visible / (2 * tan));
      }
    }
    to.updateProjectionMatrix();
    to.updateMatrixWorld();
    this.active = to;
    this.kind = type;
    if (opts.controls) {
      opts.controls.object = to;
      if (target) opts.controls.target.copy(target);
      opts.controls.update();
    }
    this.onChange?.(to, type);
    return to;
  }

  /**
   * Orthographic zoom that fits a sphere of `radius` (with `margin`) in the
   * current frustum — the ortho counterpart of backing a perspective camera
   * off to `radius / sin(fov / 2)`.
   */
  fitZoom(radius: number, margin = 1.08): number {
    const aspect = this.perspective.aspect || 1;
    const visibleH = 2 * Math.max(radius, 1e-6) * margin;
    return Math.min(this.frustumSize / visibleH, (this.frustumSize * aspect) / visibleH);
  }

  /** World units per CSS pixel at `point` for the active camera. */
  worldPerPixel(point: THREE.Vector3, viewportHeightPx: number): number {
    const h = Math.max(viewportHeightPx, 1);
    if (this.active === this.orthographic) return this.frustumSize / this.orthographic.zoom / h;
    const d = this.perspective.position.distanceTo(point);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov) / 2)) / h;
  }
}
