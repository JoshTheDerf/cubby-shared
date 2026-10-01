/**
 * Action registry records shared by CubbyCAD and CubbySlicer. An Action is
 * declared once and projected onto every surface (menus, command palette,
 * toolbars, keyboard, shortcuts help). `when` / `state` / `run` read the app's
 * single reactive context, so action tables stay pure data modules.
 *
 * Generic over the app context `C`, its category names and keyboard scopes;
 * each app extends `ActionBase` with its own surface fields.
 */

/** Declarative key binding: the single source for display chips and dispatch matching. */
export interface KeyBinding<S extends string = string> {
  /** Lower-cased `event.key`, e.g. 'z', 'delete', 'escape', '?'. */
  key?: string;
  /** `event.code` (layout independent, e.g. 'Numpad1'). Takes precedence over `key`. */
  code?: string;
  /** Ctrl on Windows/Linux, ⌘ on macOS. */
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Keyboard activation scope. No scope = global. */
  scope?: S;
  /** Verbatim display chips (overrides the derived tokens). */
  displayTokens?: string[];
  /** Tooltip / help chip only: the dispatcher never matches it. */
  displayOnly?: boolean;
  /**
   * A matching key is normally preventDefault'ed even when the action is gated
   * off (so Ctrl+S never opens the browser's save dialog). Keys with an
   * important native meaning (Tab, Escape) set this to fall through instead.
   */
  passThroughWhenUnavailable?: boolean;
  /**
   * Keyboard only: dispatch just while focus is idle (body / the viewport
   * canvas) and no text is selected, so Ctrl+C / arrows / Tab keep their native
   * meaning inside panels. Implies `passThroughWhenUnavailable` otherwise.
   */
  whenFocusIdle?: boolean;
}

export type ActionState = 'on' | 'off' | 'active' | undefined;

export interface ActionBase<C, Cat extends string = string, S extends string = string> {
  /** Namespaced, stable, unique. e.g. 'object.mirror.x'. */
  id: string;
  /** Human label (menus, palette, toolbar, help). */
  title: string;
  icon?: string;
  category: Cat;
  /** Extra search terms for the palette. */
  aliases?: string[];
  binding?: KeyBinding<S>;
  /** Availability. Pure, synchronous and cheap (called inside computeds and on every keypress). */
  when?: (ctx: C) => boolean;
  /** Toggle / active state: ✓ in menus, highlighted toolbar button, "Turn on/off" in the palette. */
  state?: (ctx: C) => ActionState;
  /** Label swaps ("Hide" / "Show"). Menus keep `title` + ✓ when `state` is set. */
  dynamicTitle?: (ctx: C) => string;
  /** Icon swaps (eye / eye-off). Falls back to `icon`. */
  dynamicIcon?: (ctx: C) => string;
  /** Side effect. May be async (the dispatcher awaits it). */
  run: (ctx: C) => void | Promise<void>;
  /** Hide from the shortcuts help. */
  hidden?: boolean;
}
