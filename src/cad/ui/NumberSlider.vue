<template>
  <!-- Blender-style number button: the whole bar is a large, touch-friendly
       drag handle (scrub left/right to change the value), and a click (a press
       with no drag) flips it into a text field for typing an exact value.
       Replaces the previous side-by-side USlider + UInputNumber pair while
       keeping the exact same props/emits surface. -->
  <div
    ref="rootEl"
    class="relative isolate flex items-center w-full select-none rounded-md overflow-hidden ring-1 ring-inset ring-accented bg-default transition-colors"
    :class="[
      sizePad,
      sizeText,
      sizeMinH,
      {
        'opacity-75 cursor-not-allowed': props.disabled,
        'cursor-ew-resize hover:bg-elevated/50 hover:ring-primary/40':
          !props.disabled && !editing,
        'ring-2 ring-primary': editing,
      },
    ]"
    :tabindex="props.disabled || editing ? -1 : 0"
    :role="editing ? undefined : 'slider'"
    :aria-valuemin="editing ? undefined : ariaMin"
    :aria-valuemax="editing ? undefined : ariaMax"
    :aria-valuenow="editing ? undefined : currentNum()"
    :aria-valuetext="editing ? undefined : displayValue"
    :aria-disabled="props.disabled || undefined"
    :style="{ touchAction: props.disabled ? 'auto' : 'none' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @keydown="onSliderKeyDown"
    @keyup="flushPending"
    @blur="flushPending"
  >
    <!-- filled portion (left → value). Dark grey so it reads as a value bar,
         not a highlight. `isolate` on the root scopes the text's difference
         blend to this container so the readout self-inverts over the fill. -->
    <div
      v-if="!editing"
      class="absolute inset-y-0 left-0 bg-(--ui-color-neutral-600) pointer-events-none"
      :style="{ width: fillPercent + '%' }"
    />
    <!-- leading edge handle -->
    <div
      v-if="!editing && fillPercent > 0"
      class="absolute top-0 bottom-0 w-0.5 -ml-px bg-(--ui-color-neutral-600) pointer-events-none"
      :style="{ left: fillPercent + '%' }"
    />
    <!-- value readout: white + difference blend → dark text over the light
         background, light text over the dark-grey fill, automatically. -->
    <span
      v-if="!editing"
      class="relative z-[1] w-full text-right font-mono tabular-nums text-neutral-50 mix-blend-difference truncate"
      aria-hidden="true"
    >{{ displayValue }}</span>
    <!-- inline edit field -->
    <input
      v-else
      ref="inputEl"
      v-model="text"
      type="text"
      inputmode="decimal"
      class="absolute inset-0 w-full h-full bg-transparent text-right font-mono tabular-nums text-highlighted outline-none px-2"
      @keydown="onInputKeyDown"
      @blur="commit"
    />
  </div>
</template>

<script setup lang="ts">
import { formatCompact } from '../../gizmo/format';
import { computed, nextTick, ref } from 'vue';

const props = defineProps<{
  modelValue: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  /** Slider upper bound when no hard `max` is supplied. Dragging is clamped to
   *  this value; typing is clamped to `max`. Mirrors the old two-control split
   *  where the slider ran to `sliderMax` but the input accepted up to `max`. */
  sliderMax?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  /**
   * Emit ONCE when the interaction ends instead of on every pointer move / key
   * repeat.
   *
   * The default (continuous) is right for a control whose handler is cheap and
   * whose live feedback is the point. It is badly wrong for one whose handler
   * records an undoable operation and kicks off a full re-bake: a single drag
   * across the track then queues dozens of rebuilds, each of an intermediate
   * value the user never asked for, and the UI stalls while they all run. The
   * sculpt Detail control is exactly that case.
   *
   * While the interaction is live the readout tracks a LOCAL pending value, so
   * the control still feels continuous — only the commit is deferred.
   */
  commitOnRelease?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: number] }>();

/** Visual + drag upper bound: the hard `max` if given, else `sliderMax`. */
const effectiveMax = computed<number | undefined>(() => props.max ?? props.sliderMax);

const ariaMin = computed(() => props.min ?? 0);
const ariaMax = computed(() => props.max ?? effectiveMax.value ?? 100);

/** Uncommitted value during a `commitOnRelease` interaction; null when idle. */
const pending = ref<number | null>(null);

function currentNum(): number {
  if (pending.value !== null) return pending.value;
  return Number(props.modelValue ?? 0);
}

/** Emit `v`, or hold it as the pending value when committing on release. */
function push(v: number): void {
  if (props.commitOnRelease) pending.value = v;
  else emit('update:modelValue', v);
}

/** Flush a held value at the end of an interaction. */
function flushPending(): void {
  if (pending.value === null) return;
  const v = pending.value;
  pending.value = null;
  if (v !== Number(props.modelValue ?? 0)) emit('update:modelValue', v);
}

/** Decimal places implied by a number (0 for ints), with a fallback for
 *  undefined (used when no step is supplied so smooth values stay readable). */
function decimalsOf(n: number | undefined, fallback = 0): number {
  if (n === undefined || !Number.isFinite(n)) return fallback;
  const str = Number(n.toPrecision(10)).toString();
  const dot = str.indexOf('.');
  return dot < 0 ? 0 : str.length - dot - 1;
}

/** Decimals to display/trim to: enough to represent both the min offset and the
 *  step granularity, so e.g. min=0.1 step=1 still renders "1.1" not "1". */
function displayDecimals(): number {
  const dStep = decimalsOf(props.step, 3);
  const dMin = decimalsOf(props.min, 0);
  return Math.min(Math.max(dStep, dMin), 6);
}

function trim(v: number): number {
  return Number(v.toFixed(displayDecimals()));
}

/** Label precision: never coarser than the value itself (typed values bypass the
 *  step, and coarse steps like 1 were rendering 2.37 as "2"). At least 2 decimals,
 *  more when the step/min demand it; trailing zeros are stripped. */
function formatValue(v: number): string {
  return formatCompact(v, Math.max(displayDecimals(), 2));
}

const displayValue = computed(() => formatValue(currentNum()));

const fillPercent = computed(() => {
  const v = currentNum();
  const lo = props.min ?? 0;
  const hi = effectiveMax.value ?? v;
  if (hi <= lo) return 0;
  return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
});

const sizePad = computed(() => {
  switch (props.size) {
    case 'xs': return 'py-1 px-2';
    case 'sm': return 'py-1.5 px-2.5';
    case 'lg': return 'py-2 px-3';
    case 'xl': return 'py-2.5 px-3';
    default: return 'py-1.5 px-2.5'; // md + unset
  }
});

const sizeText = computed(() => {
  switch (props.size) {
    case 'xs': return 'text-xs';
    case 'lg':
    case 'xl': return 'text-base';
    default: return 'text-sm';
  }
});

/** Matches Nuxt UI UInput heights so the control is the same size in slider
 *  and edit mode (the absolute input contributes no in-flow height, so without
 *  this the bar would collapse to padding-only when editing). */
const sizeMinH = computed(() => {
  switch (props.size) {
    case 'xs': return 'min-h-6';
    case 'sm': return 'min-h-7';
    case 'lg': return 'min-h-9';
    case 'xl': return 'min-h-10';
    default: return 'min-h-8'; // md + unset
  }
});

/** Snap to the nearest step from `min` (no-op when there is no step). */
function snap(v: number): number {
  if (!props.step) return v;
  const lo = props.min ?? 0;
  return lo + Math.round((v - lo) / props.step) * props.step;
}

// ── inline text edit ───────────────────────────────────────────────────────
const editing = ref(false);
const text = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

function enterEdit() {
  if (props.disabled) return;
  text.value = formatValue(currentNum());
  editing.value = true;
  nextTick(() => {
    const el = inputEl.value;
    if (el) { el.focus(); el.select(); }
  });
}

function commit() {
  if (!editing.value) return;
  editing.value = false;
  // A typed value supersedes anything held from a drag/keyboard interaction.
  pending.value = null;
  const parsed = parseFloat(text.value);
  if (!Number.isFinite(parsed)) return; // discard invalid / empty → revert
  const lo = props.min ?? -Infinity;
  const hi = props.max ?? Infinity;
  // CLAMP ONLY — no `trim`. Dragging and the arrow keys snap to `step` because
  // that is what makes a scrub feel controllable, but typing is the exact-value
  // escape hatch (it is why `max` and `sliderMax` are separate props). Running
  // the typed number through the step's display decimals turned 0.125 into 0.13
  // — the control silently "correcting" input the user had entered deliberately.
  emit('update:modelValue', Math.min(Math.max(parsed, lo), hi));
}

function onInputKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') { e.preventDefault(); commit(); }
  else if (e.key === 'Escape') { e.preventDefault(); editing.value = false; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(e.shiftKey ? 10 : 1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(e.shiftKey ? -10 : -1); }
}

function nudge(mult: number) {
  const s = props.step ?? 1;
  const base = Number.isFinite(parseFloat(text.value)) ? parseFloat(text.value) : currentNum();
  const lo = props.min ?? -Infinity;
  const hi = props.max ?? Infinity;
  text.value = formatValue(trim(Math.min(Math.max(base + s * mult, lo), hi)));
}

// ── pointer scrubbing (mouse / touch / pen) ─────────────────────────────────
const rootEl = ref<HTMLElement | null>(null);
let dragging = false;
let moved = false;
let startX = 0;
let startVal = 0;
let trackWidth = 1;
let activePointer = -1;

function onPointerDown(e: PointerEvent) {
  if (props.disabled || editing.value) return;
  dragging = true;
  moved = false;
  startX = e.clientX;
  startVal = currentNum();
  trackWidth = rootEl.value?.clientWidth ?? 1;
  activePointer = e.pointerId;
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  e.preventDefault();
}

function onPointerMove(e: PointerEvent) {
  if (!dragging || e.pointerId !== activePointer) return;
  const dx = e.clientX - startX;
  // The 5px threshold distinguishes a CLICK (which opens the text field) from a
  // drag. Once a drag is under way it must stop applying, or the pointer coming
  // back toward the origin is filtered out and the control commits the value it
  // passed through on the way out instead of the one under the cursor.
  if (!moved && Math.abs(dx) <= 5) return;
  moved = true;
  const lo = props.min ?? 0;
  const dragHi = effectiveMax.value ?? Math.max(startVal, lo + 1);
  const range = Math.max(1e-9, dragHi - lo);
  let unit = dx * (range / Math.max(1, trackWidth));
  if (e.shiftKey) unit *= 0.2; // finer control while held
  let nv = snap(startVal + unit);
  nv = Math.min(Math.max(nv, lo), dragHi);
  push(trim(nv));
}

function endDrag(e: PointerEvent, asClick: boolean) {
  if (!dragging || e.pointerId !== activePointer) return;
  dragging = false;
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  activePointer = -1;
  flushPending();
  if (asClick && !moved) enterEdit();
}

function onPointerUp(e: PointerEvent) { endDrag(e, true); }
function onPointerCancel(e: PointerEvent) { endDrag(e, false); }

// ── keyboard (slider state) ─────────────────────────────────────────────────
function bump(delta: number) {
  const lo = props.min ?? 0;
  const hi = effectiveMax.value ?? Infinity;
  // Held arrow keys repeat, so this needs the same deferral as a drag — see
  // `commitOnRelease`. `onSliderKeyUp` flushes.
  push(trim(Math.min(Math.max(snap(currentNum() + delta), lo), hi)));
}

function onSliderKeyDown(e: KeyboardEvent) {
  if (props.disabled || editing.value) return;
  const s = props.step ?? 1;
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      e.preventDefault(); bump(s * (e.shiftKey ? 10 : 1)); break;
    case 'ArrowDown':
    case 'ArrowLeft':
      e.preventDefault(); bump(-s * (e.shiftKey ? 10 : 1)); break;
    case 'Home':
      if (props.min !== undefined) { e.preventDefault(); emit('update:modelValue', trim(props.min)); }
      break;
    case 'End': {
      const end = effectiveMax.value;
      if (end !== undefined) { e.preventDefault(); emit('update:modelValue', trim(end)); }
      break;
    }
    case 'Enter':
    case ' ':
      e.preventDefault(); enterEdit(); break;
  }
}
</script>
