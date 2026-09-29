/**
 * Brand-anchored interaction palette for the 3D viewport (numeric hex for
 * three.js materials). ONE blue, ONE orange, one red, one green — the same
 * tokens the chrome reads from CSS (`--cubby-primary` / `--cubby-accent` in
 * style.css, ported from the marketing site). Before this module, viewport
 * layers had drifted across seven different "action blues" (0x4488ff,
 * 0x3b82f6, 0x38bdf8, 0x22d3ee, 0x0ea5e9, 0x60a5fa, 0x4f8ff7) and three
 * warms; every hover/selection/preview colour should come from here instead.
 *
 *  - PRIMARY:      actions, hover targets, previews, gizmo chrome
 *  - PRIMARY_SOFT: lighter hover/handle tint where it must read as
 *                  "interactive but not selected" next to PRIMARY
 *  - WARM:         the selected state (site's warm accent) — contrasts with
 *                  the blue interaction chrome
 *  - WARM_SOFT:    passive warm markers (bones, recolor hints)
 */
export const INTERACT_PRIMARY = 0x2b7fff;      // --cubby-primary (brand blue)
export const INTERACT_PRIMARY_SOFT = 0x7db2ff; // lightened brand blue
export const INTERACT_WARM = 0xe8702a;         // --cubby-accent (warm orange)
export const INTERACT_WARM_SOFT = 0xf59e0b;    // amber — passive warm markers
export const INTERACT_DANGER = 0xef4444;       // destructive (erase/carve/axis)
export const INTERACT_SUCCESS = 0x22c55e;      // confirmation (snap hits)
