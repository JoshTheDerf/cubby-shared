/**
 * Tiny wrapper over the Vibration API for mobile tactile feedback.
 *
 * Gated to coarse-pointer devices (phones / tablets) so callers can fire freely
 * from shared edit paths without each one re-checking the platform — on a
 * desktop (fine pointer, no vibrator) every helper is a silent no-op. The
 * coarse-pointer flag tracks live (plugging in a mouse flips it) so a 2-in-1
 * doesn't keep buzzing once it's docked.
 */

let coarse = false;
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(pointer: coarse)');
  coarse = mq.matches;
  const onChange = (e: MediaQueryListEvent): void => { coarse = e.matches; };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange); // Safari < 14
}

function fire(pattern: number | number[]): void {
  if (!coarse || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    /* permissions / unsupported hardware — feedback is best-effort */
  }
}

/** A light confirmation tick — selection, single placement, tap-to-use. */
export function hapticTap(): void { fire(8); }

/** A firmer pulse for a committed change (gizmo transform, long-press latch). */
export function hapticCommit(): void { fire(16); }

/**
 * Continuous painting feedback (per brush dab). Throttled so a fast drag feels
 * like a steady light buzz rather than overrunning the vibrator queue with
 * hundreds of overlapping pulses.
 */
let lastPaint = 0;
export function hapticPaint(): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (now - lastPaint < 45) return;
  lastPaint = now;
  fire(6);
}
