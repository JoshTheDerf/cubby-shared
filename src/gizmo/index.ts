/**
 * @cubby/shared/gizmo — CubbyCAD's TinkerCad-style edit gizmo (scale handles,
 * floor-translate, lift cone, rotation arcs + dial, editable dimension labels),
 * shared by the editor and CubbySlicer.
 *
 * - `EditGizmo`: the gizmo itself (Y-up, one target Object3D, the editor's
 *   callback API). CubbyCAD uses it directly.
 * - `TransformGizmo`: a host wrapper — multi-object / matrix targets, a Z-up
 *   option, drag start / change / end events and a pointer hit test. Cubby
 *   Slicer uses it.
 * - The building blocks the editor's sculpt tools reuse (handle parts, math,
 *   constants) and the small shared helpers they depend on (touch scale,
 *   haptics, pick ray, number format, interaction colours).
 */
export { EditGizmo } from './EditGizmo';
export type {
  EditGizmoEventMap,
  GizmoAttachOptions,
  GizmoMode,
  GizmoObjectChangeCallback,
  GizmoSpace,
  GizmoTransformCallback,
} from './EditGizmo';
export { TransformGizmo } from './transformGizmo';
export type {
  GizmoTarget,
  GizmoTransformEvent,
  GizmoUp,
  TransformGizmoAttachOptions,
  TransformGizmoEventMap,
  TransformGizmoOptions,
} from './transformGizmo';

export { GIZMO_CONSTANTS } from './constants';
export type { Axis, Camera, GizmoMaterials, GizmoMesh, HandleRole } from './internal';
export * from './math';
export { buildScaleHandles } from './parts/scaleHandles';
export {
  buildRotateTriggers,
  computeRotateTriggerVisibility,
  layoutRotationTriggers,
} from './parts/rotateTriggers';

export { getTouchScale, onTouchScaleChange, setTouchScale } from './touchScale';
export { hapticCommit, hapticPaint, hapticTap } from './haptics';
export { setPickRayFromCamera } from './pickRay';
export { formatCompact, formatMM } from './format';
export * from './colors';
