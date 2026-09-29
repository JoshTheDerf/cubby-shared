/** Key-event matching shared by both apps' keyboard dispatchers. */
import type { KeyBinding } from './types';

/** True when focus is in a text-entry control, where typing must win over shortcuts. */
export function isTextInputFocused(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    return !['button', 'checkbox', 'radio', 'submit', 'range', 'color', 'file'].includes(t);
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * True when the binding matches the raw key event (key / code + modifiers).
 * Scope and `when` gate separately.
 *
 *  - `code` (e.g. Numpad1) matches `event.code` and ignores `key`, so it
 *    survives keyboard layouts; otherwise `key` matches case-insensitively.
 *    Keyless and display-only bindings never match.
 *  - Strict modifiers: an unspecified modifier must NOT be held, so a bare 'r'
 *    doesn't swallow Ctrl+R and Ctrl+I doesn't swallow Ctrl+Shift+I.
 *  - A single non-alphanumeric key ('?', '{') already encodes Shift in
 *    `event.key`, so Shift isn't checked for it.
 */
export function bindingMatchesKey(b: KeyBinding | undefined, e: KeyboardEvent): boolean {
  if (!b || b.displayOnly) return false;
  if (b.code) { if (b.code !== e.code) return false; }
  else {
    if (!b.key) return false;
    if (b.key.toLowerCase() !== e.key.toLowerCase()) return false;
  }
  if ((b.ctrlOrMeta ?? false) !== (e.ctrlKey || e.metaKey)) return false;
  const keyEncodesShift = !b.code && !!b.key && b.key.length === 1 && !/[a-z0-9]/i.test(b.key);
  if (!keyEncodesShift && (b.shift ?? false) !== e.shiftKey) return false;
  if ((b.alt ?? false) !== e.altKey) return false;
  return true;
}
