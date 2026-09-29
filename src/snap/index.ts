/**
 * @cubby/shared/snap — the grid / increment snap both apps offer.
 *
 * One number drives it: the snap increment in mm (0 = off). The edit gizmo
 * snaps moves and box extents to it and rotation to ROTATION_SNAP_DEG whenever
 * it is on; keyboard nudges step by it. Each app owns where the current value
 * lives (a Vue ref, a store) and can use `SnapSetting` for a small persisted
 * holder.
 */

export interface SnapOption {
  label: string;
  value: number;
}

/** Snap increments offered in the menus / status bar / palette, coarse to fine. */
export const SNAP_OPTIONS: readonly SnapOption[] = [
  { label: '10mm', value: 10 },
  { label: '5mm', value: 5 },
  { label: '1mm', value: 1 },
  { label: '0.5mm', value: 0.5 },
  { label: '0.25mm', value: 0.25 },
  { label: '0.1mm', value: 0.1 },
  { label: 'Off', value: 0 },
];

/** Rotation step (degrees) while any snap increment is on. */
export const ROTATION_SNAP_DEG = 15;

/** Snap a value to the nearest multiple of `increment`. `increment <= 0` is a no-op. */
export function snap(value: number, increment: number): number {
  if (increment <= 0) return value;
  return Math.round(value / increment) * increment;
}

/** Menu label for an increment ('Off', '1mm', or '0.3mm' for a custom one). */
export function snapLabel(increment: number): string {
  return SNAP_OPTIONS.find((o) => o.value === increment)?.label ?? (increment > 0 ? `${increment}mm` : 'Off');
}

/** Whether `v` is one of SNAP_OPTIONS (for validating a stored value). */
export function isSnapOption(v: unknown): v is number {
  return typeof v === 'number' && SNAP_OPTIONS.some((o) => o.value === v);
}

/**
 * The current snap increment with change listeners and optional
 * localStorage persistence (a missing / blocked store just isn't persisted).
 */
export class SnapSetting {
  private current: number;
  private readonly listeners = new Set<(v: number) => void>();

  constructor(private readonly opts: { initial?: number; storageKey?: string } = {}) {
    this.current = opts.initial ?? 0;
    if (opts.storageKey) {
      try {
        const raw = localStorage.getItem(opts.storageKey);
        const v = raw === null ? null : Number(raw);
        if (isSnapOption(v)) this.current = v;
      } catch { /* not persisted */ }
    }
  }

  get value(): number { return this.current; }

  set(v: number): void {
    if (!(v >= 0) || v === this.current) return;
    this.current = v;
    if (this.opts.storageKey) {
      try { localStorage.setItem(this.opts.storageKey, String(v)); } catch { /* not persisted */ }
    }
    for (const fn of this.listeners) fn(v);
  }

  /** Subscribe to changes; returns the unsubscribe. */
  onChange(fn: (v: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
