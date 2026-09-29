import { describe, expect, it } from 'vitest';
import { SNAP_OPTIONS, SnapSetting, isSnapOption, snap, snapLabel } from './index';

describe('snap', () => {
  it('rounds to the increment and treats <= 0 as off', () => {
    expect(snap(7.4, 5)).toBe(5);
    expect(snap(7.6, 5)).toBe(10);
    expect(snap(7.4, 0)).toBe(7.4);
  });
  it('labels and validates the offered steps', () => {
    expect(snapLabel(0)).toBe('Off');
    expect(snapLabel(0.25)).toBe('0.25mm');
    expect(isSnapOption(1)).toBe(true);
    expect(isSnapOption(3)).toBe(false);
    expect(SNAP_OPTIONS.at(-1)!.value).toBe(0);
  });
  it('SnapSetting notifies on change only', () => {
    const s = new SnapSetting({ initial: 1 });
    const seen: number[] = [];
    s.onChange((v) => seen.push(v));
    s.set(1);
    s.set(5);
    s.set(-1);
    expect(s.value).toBe(5);
    expect(seen).toEqual([5]);
  });
});
