/** Shared numeric display formatting for UI labels.
 *
 *  Labels used to round to a magnitude bucket (`formatMM`: 0 dp at ≥10mm) or to
 *  the slider step, which hid the actual value ("24mm" for 24.37, "2" for 2.37).
 *  These helpers show up to `maxDecimals` significant decimals and strip trailing
 *  zeros, so the label is as short as the value allows but never coarser than it. */

/** `v` with at most `maxDecimals` decimals, trailing zeros stripped, no "-0". */
export function formatCompact(v: number, maxDecimals = 3): string {
  if (!Number.isFinite(v)) return String(v);
  const n = Number(v.toFixed(maxDecimals));
  return String(n === 0 ? 0 : n);
}

/** Millimetre label for in-scene readouts (edit gizmo, sketch edges, last-transform): ≤2 decimals. */
export function formatMM(value: number): string {
  return `${formatCompact(value, 2)}mm`;
}
