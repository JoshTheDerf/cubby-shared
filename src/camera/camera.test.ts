import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraProjection } from './projection';
import { AXIS_CUBE_FACES, VIEW_CUBE_FACES, viewCubeThemeOptions } from './viewCubeTheme';

function visibleHeightAt(p: CameraProjection, target: THREE.Vector3): number {
  const c = p.camera;
  if (c instanceof THREE.OrthographicCamera) return (c.top - c.bottom) / c.zoom;
  return 2 * c.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
}

describe('CameraProjection', () => {
  it('keeps pose, target and apparent scale across a round trip', () => {
    const p = new CameraProjection({ perspective: { fov: 35 } });
    p.resize(800, 600);
    const target = new THREE.Vector3(110, 110, 0);
    p.camera.position.set(-150, -250, 250);
    p.camera.up.set(0, 0, 1);
    p.camera.lookAt(target);
    const before = visibleHeightAt(p, target);
    const dir = p.camera.getWorldDirection(new THREE.Vector3());
    const controls = { object: p.camera as THREE.Object3D, target: target.clone(), update: () => {} };

    p.setType('orthographic', { controls });
    expect(p.type).toBe('orthographic');
    expect(controls.object).toBe(p.orthographic);
    expect(visibleHeightAt(p, target)).toBeCloseTo(before, 6);
    expect(p.camera.getWorldDirection(new THREE.Vector3()).dot(dir)).toBeCloseTo(1, 9);
    expect(p.orthographic.up.z).toBe(1);

    p.orthographic.zoom *= 2; // user zoomed in while ortho
    p.orthographic.updateProjectionMatrix();
    const zoomed = visibleHeightAt(p, target);
    p.setType('perspective', { controls });
    expect(visibleHeightAt(p, target)).toBeCloseTo(zoomed, 6);
    expect(controls.target.toArray()).toEqual([110, 110, 0]);
  });

  it('without matchScale only copies the pose (CubbyCAD)', () => {
    const p = new CameraProjection({ matchScale: false });
    p.camera.position.set(1, 2, 3);
    p.setType('orthographic', { target: new THREE.Vector3() });
    expect(p.orthographic.zoom).toBe(1);
    expect(p.camera.position.toArray()).toEqual([1, 2, 3]);
  });

  it('keeps the ortho frustum aspect-correct', () => {
    const p = new CameraProjection({ frustumSize: 100 });
    p.resize(200, 100);
    expect(p.orthographic.right - p.orthographic.left).toBeCloseTo(200);
    expect(p.orthographic.top - p.orthographic.bottom).toBeCloseTo(100);
  });
});

describe('viewCubeThemeOptions', () => {
  it('Y-up keys the named faces; Z-up keys the axes and labels the bed', () => {
    const y = viewCubeThemeOptions(true);
    for (const f of VIEW_CUBE_FACES) expect(y[f]).toBeTruthy();
    expect(y.background).toBeUndefined();
    const z = viewCubeThemeOptions(true, { up: 'z' });
    for (const f of AXIS_CUBE_FACES) expect(z[f]!.label).toBeTruthy();
    expect(z.ny!.label).toBe('Front');
  });
});
