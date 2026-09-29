// @vitest-environment jsdom
/**
 * TransformGizmo: the EditGizmo driven through the host API, Z-up. jsdom has
 * no WebGL, but the gizmo only needs Object3D state, DOM pointer events and
 * CSS2D label elements, so a real drag can be simulated end to end.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TransformGizmo } from './transformGizmo';

const W = 800, H = 600;

function setup() {
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.5, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(50, -150, 180);
  camera.lookAt(50, 60, 0);
  camera.updateMatrixWorld(true);
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width: W, height: H, top: 0, left: 0, right: W, bottom: H, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
  document.body.appendChild(el);
  const scene = new THREE.Scene();
  const gizmo = new TransformGizmo(camera, el, { up: 'z' });
  scene.add(gizmo.object);
  // A 10 × 20 × 30 box standing on the bed at (50, 60).
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 30), new THREE.MeshBasicMaterial());
  mesh.position.set(50, 60, 15);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  return { camera, el, scene, gizmo, mesh };
}

function screen(camera: THREE.Camera, p: THREE.Vector3): { clientX: number; clientY: number } {
  const v = p.clone().project(camera);
  return { clientX: ((v.x + 1) / 2) * W, clientY: ((1 - v.y) / 2) * H };
}

/** jsdom has no PointerEvent: a MouseEvent with the pointer fields the gizmo reads. */
function pointer(el: HTMLElement, type: string, at: { clientX: number; clientY: number }): void {
  const e = new MouseEvent(type, { ...at, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true });
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  el.dispatchEvent(e);
}

describe('TransformGizmo (up: z)', () => {
  it('lays the box out in bed axes: floor on z = min, box height along +Z', () => {
    const { gizmo, mesh } = setup();
    gizmo.attach(mesh);
    gizmo.update();
    // The gizmo's rendered subtree (through the basis change) must bound the
    // mesh's world box: 10 × 20 in XY, 30 tall in Z — not 30 deep in Y.
    const box = new THREE.Box3();
    gizmo.object.updateMatrixWorld(true);
    gizmo.object.traverse((o) => {
      const m = o as THREE.LineSegments;
      // The box outline (handle edge lines are children of the handle meshes).
      let shown = true;
      for (let a: THREE.Object3D | null = o; a; a = a.parent) shown &&= a.visible;
      if (m.isLineSegments && shown && !(o.parent as THREE.Mesh).isMesh) {
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
      }
    });
    expect(box.min.z).toBeCloseTo(0, 3);
    expect(box.max.z).toBeCloseTo(30, 3);
    expect(box.max.x - box.min.x).toBeCloseTo(10, 3);
    expect(box.max.y - box.min.y).toBeCloseTo(20, 3);
  });

  it('a floor drag moves the target in XY only, with one start / end', () => {
    const { camera, el, gizmo, mesh } = setup();
    gizmo.setMode('translate');
    gizmo.attach(mesh);
    gizmo.update();
    const events: string[] = [];
    let endDelta: THREE.Matrix4 | null = null;
    gizmo.addEventListener('grab-changed', (e) => events.push(`grab:${e.value}`));
    gizmo.addEventListener('drag-start', () => events.push('start'));
    gizmo.addEventListener('drag-end', (e) => { events.push('end'); endDelta = e.delta; });

    const grab = screen(camera, new THREE.Vector3(50, 60, 0.01));
    expect(gizmo.hitTest(grab)).toBe(true);
    expect(gizmo.hitTest({ clientX: 5, clientY: 5 })).toBe(false);
    pointer(el, 'pointerdown', grab);
    expect(gizmo.grabbed).toBe(true);
    const to = screen(camera, new THREE.Vector3(70, 50, 0));
    for (let i = 1; i <= 5; i++) {
      pointer(el, 'pointermove', {
        clientX: grab.clientX + ((to.clientX - grab.clientX) * i) / 5,
        clientY: grab.clientY + ((to.clientY - grab.clientY) * i) / 5,
      });
    }
    pointer(el, 'pointerup', to);

    expect(events).toEqual(['grab:true', 'start', 'grab:false', 'end']);
    expect(mesh.position.x).toBeCloseTo(70, 1);
    expect(mesh.position.y).toBeCloseTo(50, 1);
    expect(mesh.position.z).toBeCloseTo(15, 6);
    const t = new THREE.Vector3().setFromMatrixPosition(endDelta!);
    expect(t.x).toBeCloseTo(20, 1);
    expect(t.y).toBeCloseTo(-10, 1);
    expect(t.z).toBeCloseTo(0, 6);
  });

  it('a click on a handle without moving commits nothing', () => {
    const { camera, el, gizmo, mesh } = setup();
    gizmo.attach(mesh);
    gizmo.update();
    let starts = 0;
    gizmo.addEventListener('drag-start', () => { starts++; });
    const at = screen(camera, new THREE.Vector3(50, 60, 0.01));
    pointer(el, 'pointerdown', at);
    pointer(el, 'pointerup', at);
    expect(starts).toBe(0);
    expect(mesh.position.toArray()).toEqual([50, 60, 15]);
  });

  it('moves several targets as a group and hides / shows without detaching', () => {
    const { camera, el, gizmo, mesh, scene } = setup();
    const other = mesh.clone();
    other.position.set(80, 60, 15);
    scene.add(other);
    scene.updateMatrixWorld(true);
    gizmo.setMode('translate');
    gizmo.attach([mesh, other]);
    gizmo.update();
    gizmo.hide();
    const grab = screen(camera, new THREE.Vector3(65, 60, 0.01));
    expect(gizmo.hitTest(grab)).toBe(false);
    gizmo.show();
    expect(gizmo.hitTest(grab)).toBe(true);
    pointer(el, 'pointerdown', grab);
    const to = screen(camera, new THREE.Vector3(65, 70, 0));
    pointer(el, 'pointermove', { clientX: (grab.clientX + to.clientX) / 2, clientY: (grab.clientY + to.clientY) / 2 });
    pointer(el, 'pointermove', to);
    pointer(el, 'pointerup', to);
    expect(mesh.position.y).toBeCloseTo(70, 1);
    expect(other.position.y).toBeCloseTo(70, 1);
    expect(other.position.x - mesh.position.x).toBeCloseTo(30, 6);
  });
});
