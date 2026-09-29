import {
  INTERACT_PRIMARY, INTERACT_PRIMARY_SOFT, INTERACT_WARM, INTERACT_WARM_SOFT,
} from './colors';

export const GIZMO_CONSTANTS = {
  OUTLINE_COLOR: INTERACT_PRIMARY,

  HANDLE_FILL: 0xffffff,
  HANDLE_EDGE: INTERACT_PRIMARY,
  HANDLE_HOVER: INTERACT_PRIMARY_SOFT,
  HANDLE_ACTIVE: INTERACT_WARM,

  // Single neutral rotate color — per-axis red/green/blue was leaking the
  // X/Y/Z color convention to users who don't think in those terms. The arcs'
  // 3D orientation already communicates which axis they rotate around.
  ROTATE_COLOR: INTERACT_PRIMARY,

  TRANSLATE_FLOOR_COLOR: 0xffffff,
  TRANSLATE_FLOOR_HOVER: INTERACT_WARM_SOFT,

  LIFT_COLOR: 0x222222,

  // "Edit sculpt layer" handle — a click-button floating outside the box when
  // the selection is a group that contains a sculpt layer. Warm accent to read
  // as a distinct, brush/clay affordance rather than a transform handle.
  SCULPT_HANDLE_COLOR: INTERACT_WARM,
  SCULPT_HANDLE_HOVER: INTERACT_WARM_SOFT,
  // Distance (CSS px) from the box's top-left edge to the sculpt handle, out
  // and up so it clears the scale handles, the lift cone, and the rotate arcs.
  SCULPT_HANDLE_OFFSET_PX: 34,

  // Approximate handle size in CSS pixels at any zoom.
  HANDLE_PX: 12,
  ROTATE_RING_PX: 80,
  ROTATE_RING_THICKNESS_PX: 6,
  LIFT_HEIGHT_PX: 32,
  // Distance (CSS px) from the box face to the lift cone's center, so the
  // cone's base clears the top scale handle's footprint.
  LIFT_OFFSET_PX: 28,
  // Additional CSS-px clearance applied on touch (scaled by touchScale-1),
  // pushing the lift cone further from the top scale handle so they're easier
  // to differentiate by finger.
  LIFT_TOUCH_EXTRA_OFFSET_PX: 40,
  // Click-vs-drag threshold (CSS px). Pointer motion below this between
  // pointerdown and pointerup is treated as a click — used to select a
  // scale handle for dimension-label editing instead of starting a drag.
  CLICK_MOVE_THRESHOLD_PX: 3,

  // Rotation trigger cluster: floats at a fixed screen offset above-and-behind
  // the OBB so it never grows with mesh size.
  // Arc size in screen pixels (torus radius scales linearly with this).
  ROTATE_TRIGGER_PX: 56,
  // How far above (or below) the OBB edge to lift the trigger so the arc tube
  // doesn't intersect the mesh face.
  ROTATE_TRIGGER_EDGE_LIFT_PX: 12,
  // Dominance threshold: above this |dot(axis, cameraForward)| the trigger
  // becomes the only one shown. Below it, all axes above ROTATE_TRIGGER_VIS_DOT
  // are shown together.
  ROTATE_TRIGGER_DOMINANT_DOT: 0.75,
  ROTATE_TRIGGER_VIS_DOT: 0.25,

  // Render order so gizmo draws on top.
  RENDER_ORDER: 999,

  // Limits.
  MIN_LOCAL_DIMENSION: 0.01,
  MIN_WORLD_DIMENSION: 0.1,

  // World-units outward offset for dimension labels so they sit clear of
  // adjacent edges/handles instead of overlapping them.
  DIM_LABEL_OFFSET_MM: 2,
} as const;
