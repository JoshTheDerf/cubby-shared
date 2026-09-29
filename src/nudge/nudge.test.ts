import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NudgeBurst, nudgeDelta, nudgeStep, resolveArrowAxes } from './index';

const arr = (v: THREE.Vector3 | null) => v && v.toArray().map((n) => Math.round(n * 1e6) / 1e6 + 0);

describe('nudgeDelta', () => {
  it('fixed Z-up bed axes: arrows move ±X / ±Y, never Z', () => {
    expect(arr(nudgeDelta('ArrowRight', { step: 10, up: 'z' }))).toEqual([10, 0, 0]);
    expect(arr(nudgeDelta('ArrowLeft', { step: 10, up: 'z' }))).toEqual([-10, 0, 0]);
    expect(arr(nudgeDelta('ArrowUp', { step: 10, up: 'z' }))).toEqual([0, 10, 0]);
    expect(arr(nudgeDelta('ArrowDown', { step: 10, up: 'z' }))).toEqual([0, -10, 0]);
    expect(nudgeDelta('KeyA', { step: 10, up: 'z' })).toBeNull();
  });

  it('Shift+Up/Down is vertical only when asked (CubbyCAD)', () => {
    expect(arr(nudgeDelta('ArrowUp', { step: 2, shiftVertical: true, shift: true }))).toEqual([0, 2, 0]);
    expect(arr(nudgeDelta('ArrowUp', { step: 2, up: 'z', shiftVertical: true, shift: true }))).toEqual([0, 0, 2]);
    expect(arr(nudgeDelta('ArrowUp', { step: 2, up: 'z', shift: true }))).toEqual([0, 2, 0]);
  });

  it('camera-relative in a Z-up world: screen right / up stay on the bed plane', () => {
    const cam = new THREE.PerspectiveCamera();
    cam.up.set(0, 0, 1);
    cam.position.set(0, -100, 100); // in front of the bed, looking at it
    cam.lookAt(0, 0, 0);
    expect(arr(nudgeDelta('ArrowRight', { step: 1, up: 'z', camera: cam }))).toEqual([1, 0, 0]);
    expect(arr(nudgeDelta('ArrowUp', { step: 1, up: 'z', camera: cam }))).toEqual([0, 1, 0]);
  });

  it('resolveArrowAxes defaults to the Y-up ground (X / Z)', () => {
    const a = resolveArrowAxes(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
    expect(arr(a.horizontalAxis)).toEqual([1, 0, 0]);
    expect(arr(a.verticalAxis)).toEqual([0, 0, 1]);
  });
});

describe('nudgeStep', () => {
  it('follows the grid snap, with a fallback when off', () => {
    expect(nudgeStep(5)).toBe(5);
    expect(nudgeStep(0, { fallback: 10 })).toBe(10);
    expect(nudgeStep(0, { fallback: 10, fine: true })).toBe(1);
  });
});

describe('NudgeBurst', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('seals once after the keys go idle, and flush seals early', () => {
    vi.useFakeTimers();
    const seal = vi.fn();
    const b = new NudgeBurst(seal, 700);
    b.bump(); vi.advanceTimersByTime(500);
    b.bump(); vi.advanceTimersByTime(500);
    expect(seal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(seal).toHaveBeenCalledTimes(1);
    b.bump();
    b.flush();
    expect(seal).toHaveBeenCalledTimes(2);
    b.flush();
    expect(seal).toHaveBeenCalledTimes(2);
  });
});
