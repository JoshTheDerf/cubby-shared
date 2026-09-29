import { describe, expect, it, vi } from 'vitest';
import { bindingMatchesKey, createActionRegistry, formatBinding, formatBindingTokens } from './index';

const key = (k: string, m: Partial<KeyboardEvent> = {}) =>
  ({ key: k, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m }) as KeyboardEvent;

describe('formatBinding', () => {
  it('orders modifiers Ctrl, Alt, Shift and labels special keys', () => {
    expect(formatBinding({ key: 'z', ctrlOrMeta: true, shift: true }, 'other')).toBe('Ctrl+Shift+Z');
    expect(formatBinding({ key: 'f', alt: true, shift: true }, 'other')).toBe('Alt+Shift+F');
    expect(formatBinding({ key: 'delete' }, 'other')).toBe('Delete');
    expect(formatBinding({ key: ' ' }, 'other')).toBe('Space');
    expect(formatBinding({ code: 'Numpad1', ctrlOrMeta: true }, 'other')).toBe('Ctrl+Numpad 1');
  });
  it('uses glyphs on macOS and honours displayTokens', () => {
    expect(formatBinding({ key: 'z', ctrlOrMeta: true, shift: true }, 'mac')).toBe('⌘⇧Z');
    expect(formatBindingTokens({ displayTokens: ['Enter / Esc'] }, 'other')).toEqual(['Enter / Esc']);
    expect(formatBinding(undefined, 'other')).toBe('');
  });
});

describe('bindingMatchesKey', () => {
  it('is strict about unspecified modifiers', () => {
    expect(bindingMatchesKey({ key: 'r' }, key('r'))).toBe(true);
    expect(bindingMatchesKey({ key: 'r' }, key('r', { ctrlKey: true }))).toBe(false);
    expect(bindingMatchesKey({ key: 's', ctrlOrMeta: true }, key('s', { metaKey: true }))).toBe(true);
  });
  it('ignores Shift for shifted symbols, prefers code, skips display-only', () => {
    expect(bindingMatchesKey({ key: '?' }, key('?', { shiftKey: true }))).toBe(true);
    expect(bindingMatchesKey({ code: 'Numpad1' }, key('End', { code: 'Numpad1' }))).toBe(true);
    expect(bindingMatchesKey({ key: 'b', displayOnly: true }, key('b'))).toBe(false);
    expect(bindingMatchesKey({}, key('b'))).toBe(false);
  });
});

describe('createActionRegistry', () => {
  it('keeps registration order, disposes only its own entries and reports changes', () => {
    const onChange = vi.fn();
    const r = createActionRegistry<{ id: string; n: number }>(onChange);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const disposeA = r.registerActions([{ id: 'a', n: 1 }, { id: 'b', n: 1 }]);
    r.registerActions([{ id: 'b', n: 2 }]);
    expect(warn).toHaveBeenCalledOnce();
    expect(r.getAllActions().map((a) => a.id)).toEqual(['a', 'b']);
    disposeA();
    expect(r.getAllActions()).toEqual([{ id: 'b', n: 2 }]);
    r.clearActions();
    expect(r.getAction('b')).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});
