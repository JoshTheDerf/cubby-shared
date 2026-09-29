import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GIZMO_CONSTANTS as G } from '../constants';
import { formatMM, type Axis, type GizmoMesh } from '../internal';
import { formatCompact } from '../format';

export interface DimensionLabelSet {
  x: CSS2DObject;
  y: CSS2DObject;
  z: CSS2DObject;
}

export interface DimensionLabelHandlers {
  onLabelClick: (axis: Axis, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }) => void;
}

export function buildDimensionLabels(handlers: DimensionLabelHandlers): DimensionLabelSet {
  const outline = '#' + G.OUTLINE_COLOR.toString(16).padStart(6, '0');
  const make = (axis: Axis) => {
    const div = document.createElement('div');
    div.className = 'cubby-3d-label';
    div.style.cssText = `
      border: 1px solid ${outline};
      font: 11px ui-monospace, Menlo, monospace;
      padding: 1px 4px;
      border-radius: 3px;
      pointer-events: none;
      white-space: nowrap;
      transform: translate(-50%, -50%);
      user-select: none;
    `;
    div.textContent = '0';
    div.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onLabelClick(axis, {
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey || e.metaKey,
      });
    });
    return new CSS2DObject(div);
  };
  return { x: make('x'), y: make('y'), z: make('z') };
}

export function setLabelText(
  labels: DimensionLabelSet,
  editingAxis: Axis | null,
  axis: Axis,
  worldLength: number,
): void {
  if (editingAxis === axis) return;
  (labels[axis].element as HTMLElement).textContent = formatMM(worldLength);
}

export function setLabelsInteractive(labels: DimensionLabelSet, on: boolean): void {
  for (const ax of ['x', 'y', 'z'] as Axis[]) {
    const el = labels[ax].element as HTMLElement;
    el.style.pointerEvents = on ? 'auto' : 'none';
    el.style.cursor = on ? 'pointer' : 'default';
  }
}

export interface UpdateDimensionLabelsParams {
  labels: DimensionLabelSet;
  targetObject: THREE.Object3D;
  box: THREE.Box3;
  space: 'local' | 'world';
  effectiveInvScale: THREE.Vector3;
  selectedScaleHandle: GizmoMesh | null;
  editingAxis: Axis | null;
  /** Camera world position expressed in the OBB's local frame, used to place
   *  resting labels on the box edges furthest from the viewer. */
  cameraLocal: THREE.Vector3;
}

export function updateDimensionLabels(params: UpdateDimensionLabelsParams): void {
  const { labels, targetObject, box, space, effectiveInvScale, selectedScaleHandle, editingAxis, cameraLocal } = params;
  let scaleX = 1, scaleY = 1, scaleZ = 1;
  if (space === 'local') {
    const ws = targetObject.getWorldScale(new THREE.Vector3());
    scaleX = Math.abs(ws.x); scaleY = Math.abs(ws.y); scaleZ = Math.abs(ws.z);
  }
  const wx = (box.max.x - box.min.x) * scaleX;
  const wy = (box.max.y - box.min.y) * scaleY;
  const wz = (box.max.z - box.min.z) * scaleZ;
  setLabelText(labels, editingAxis, 'x', wx);
  setLabelText(labels, editingAxis, 'y', wy);
  setLabelText(labels, editingAxis, 'z', wz);

  const center = box.getCenter(new THREE.Vector3());
  const inv = effectiveInvScale;
  const off = G.DIM_LABEL_OFFSET_MM;
  const ox = off * inv.x;
  const oy = off * inv.y;
  const oz = off * inv.z;
  const role = selectedScaleHandle?.userData.role;

  if (role?.kind !== 'scale') {
    // Pin each label to the box edge whose two perpendicular sides are furthest
    // from the camera, so the readout never sits on the drag handles nearest the
    // viewer. For each perpendicular axis, the far side is the one opposite the
    // camera relative to the box center; the offset pushes outward from there.
    const farX = cameraLocal.x > center.x ? box.min.x - ox : box.max.x + ox;
    const farY = cameraLocal.y > center.y ? box.min.y - oy : box.max.y + oy;
    const farZ = cameraLocal.z > center.z ? box.min.z - oz : box.max.z + oz;
    labels.x.position.set(center.x, farY, farZ);
    labels.y.position.set(farX, center.y, farZ);
    labels.z.position.set(farX, farY, center.z);
    labels.x.visible = true;
    labels.y.visible = true;
    labels.z.visible = true;
    setLabelsInteractive(labels, true);
    return;
  }

  const s = role.scaleSigns;
  const signX = s.x > 0 ? 1 : -1;
  const signZ = s.z > 0 ? 1 : -1;
  const xZ = s.z > 0 ? box.max.z : box.min.z;
  const zX = s.x > 0 ? box.max.x : box.min.x;
  const yX = s.x > 0 ? box.max.x : box.min.x;
  const yZ = s.z > 0 ? box.max.z : box.min.z;

  labels.x.position.set(center.x, box.min.y - oy, xZ + signZ * oz);
  labels.z.position.set(zX + signX * ox, box.min.y - oy, center.z);
  labels.y.position.set(yX + signX * ox, center.y, yZ + signZ * oz);
  labels.x.visible = s.x !== 0;
  labels.y.visible = s.y !== 0;
  labels.z.visible = s.z !== 0;

  setLabelsInteractive(labels, true);
}

export interface StartLabelEditParams {
  axis: Axis;
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
  labels: DimensionLabelSet;
  startWorldLength: number;
  onCommit: () => void;
  onCancel: () => void;
}

/** Open an editable <input> in the given dimension label. Caller is responsible
 *  for tracking editingAxis/editModifiers state and calling endLabelEdit. */
export function startLabelEdit(params: StartLabelEditParams): void {
  const { axis, labels, startWorldLength, onCommit, onCancel } = params;
  const label = labels[axis].element as HTMLElement;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = formatCompact(startWorldLength, 2);
  input.className = 'cubby-3d-label-input';
  input.style.cssText = `
    width: 5em;
    font: 11px ui-monospace, Menlo, monospace;
    padding: 0 2px;
    margin: 0;
    border: 1px solid #4488ff;
    outline: none;
    border-radius: 2px;
    box-sizing: border-box;
  `;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  });
  input.addEventListener('blur', () => { onCommit(); });
  input.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  label.textContent = '';
  label.appendChild(input);
  input.focus();
  input.select();
}

/** Tear down the input element and restore plain text. Returns the parsed
 *  numeric value if mode === 'commit' and parse succeeded, else null. */
export function endLabelEdit(
  labels: DimensionLabelSet,
  axis: Axis,
  mode: 'commit' | 'cancel',
  restoreLength: number,
): number | null {
  const label = labels[axis].element as HTMLElement;
  const input = label.querySelector('input');
  let newValue: number | null = null;
  if (mode === 'commit' && input instanceof HTMLInputElement) {
    const parsed = parseFloat(input.value);
    if (Number.isFinite(parsed) && parsed > 0) newValue = parsed;
  }
  label.textContent = formatMM(restoreLength);
  return newValue;
}
