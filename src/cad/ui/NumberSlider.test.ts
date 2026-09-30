// @vitest-environment jsdom
/**
 * NumberSlider's `commitOnRelease` mode.
 *
 * By default the scrub emits on every pointer move, which is right for a cheap
 * handler with live feedback. It is badly wrong for one that records an undoable
 * operation and starts a full re-bake: a single drag then queues a rebuild per
 * pointer move, each at an intermediate value the user never asked for, and the
 * app stalls while they all run. That is what the sculpt Detail control was
 * doing — reported as "it may be sending intermediate values to get meshed
 * before I actually commit".
 *
 * What must hold: the readout still tracks the pointer (so the control does not
 * feel dead), but exactly ONE value reaches the handler, at the end.
 *
 * Verify-the-test traces (both restored after observing):
 *  - `push` emitting unconditionally (ignoring commitOnRelease): three
 *    failures, headed by AssertionError: expected 3 to be 1.
 *  - `commit` re-applying `trim` to a typed value:
 *      AssertionError: expected 0.13 to be close to 0.125
 *    — the control rounding deliberate input to the step's display decimals.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import NumberSlider from './NumberSlider.vue';

/** A pointer drag far enough to clear the 5px jitter threshold. */
/** jsdom's MouseEvent has clientX as a getter, so vue-test-utils' `trigger`
 *  cannot set it. Dispatch a plain Event carrying the fields the handlers read.
 *  `setPointerCapture` is stubbed (the component already try/catches it). */
function fire(el: Element, type: string, clientX: number): void {
  const e = Object.assign(new Event(type, { bubbles: true }), { clientX, pointerId: 1 });
  el.dispatchEvent(e as Event);
}

async function drag(w: ReturnType<typeof mount>, dxs: number[]): Promise<void> {
  const el = w.find('[role="slider"]').element;
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
  fire(el, 'pointerdown', 0);
  for (const dx of dxs) fire(el, 'pointermove', dx);
  fire(el, 'pointerup', dxs[dxs.length - 1] ?? 0);
  await w.vm.$nextTick();
}

function mountSlider(props: Record<string, unknown>) {
  return mount(NumberSlider, {
    props: { modelValue: 1, min: 0, max: 10, step: 0.05, ...props },
  });
}

describe('NumberSlider commitOnRelease', () => {
  it('by default emits continuously during a drag', async () => {
    // Pinning the DEFAULT too: this mode is opt-in, and silently changing every
    // other slider in the app to defer would break live-feedback controls.
    const w = mountSlider({});
    await drag(w, [20, 40, 60]);
    expect((w.emitted('update:modelValue') ?? []).length).toBeGreaterThan(1);
  });

  it('emits exactly once, at the end, when commitOnRelease is set', async () => {
    const w = mountSlider({ commitOnRelease: true });
    await drag(w, [20, 40, 60]);
    const emitted = w.emitted('update:modelValue') ?? [];
    expect(emitted.length).toBe(1);
    // ...and the committed value is the one the pointer ended on, not an
    // intermediate.
    expect(emitted[0][0]).toBeCloseTo(7, 5);
  });

  it('still tracks the pointer visually while the commit is deferred', async () => {
    const w = mountSlider({ commitOnRelease: true });
    const el = w.find('[role="slider"]').element;
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    fire(el, 'pointerdown', 0);
    fire(el, 'pointermove', 50);
    await w.vm.$nextTick();
    // Nothing emitted yet...
    expect(w.emitted('update:modelValue')).toBeUndefined();
    // ...but the readout has moved off the model value, so the control does not
    // feel dead mid-drag.
    expect(w.text()).not.toContain('1.00');
  });

  it('does not emit when the drag ends back on the original value', async () => {
    // No-op drags must not record an undoable operation. This also pins that
    // the 5px jitter threshold stops applying once the drag is under way —
    // otherwise the return leg is filtered out and the control commits the
    // value it passed through on the way out.
    const w = mountSlider({ commitOnRelease: true });
    await drag(w, [20, 0]);
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });
});

describe('typing an exact value', () => {
  /** Click (no drag) flips the control into its text field. */
  async function typeInto(w: ReturnType<typeof mount>, value: string): Promise<void> {
    const el = w.find('[role="slider"]').element;
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    fire(el, 'pointerdown', 0);
    fire(el, 'pointerup', 0);
    await w.vm.$nextTick();
    const input = w.find('input');
    await input.setValue(value);
    await input.trigger('blur');
  }

  it('does NOT round a typed value to the step', async () => {
    // Typing is the exact-value escape hatch — it is why `max` and `sliderMax`
    // are separate props. Rounding to the step's display decimals turned 0.125
    // into 0.13, i.e. the control silently correcting deliberate input.
    const w = mountSlider({ commitOnRelease: true, step: 0.05, min: 0.05, max: 4 });
    await typeInto(w, '0.125');
    expect(w.emitted('update:modelValue')?.[0]?.[0]).toBeCloseTo(0.125, 6);
  });

  it('still clamps a typed value to min/max', async () => {
    const w = mountSlider({ commitOnRelease: true, step: 0.05, min: 0.05, max: 4 });
    await typeInto(w, '99');
    expect(w.emitted('update:modelValue')?.[0]?.[0]).toBe(4);
  });

  it('discards an unparseable entry rather than emitting NaN', async () => {
    const w = mountSlider({ commitOnRelease: true, step: 0.05, min: 0.05, max: 4 });
    await typeInto(w, 'abc');
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });
});

describe('NumberSlider label precision', () => {
  it('shows the actual value even when the step is coarse', async () => {
    const { mount } = await import('@vue/test-utils');
    const NumberSlider = (await import('./NumberSlider.vue')).default;
    const w = mount(NumberSlider, { props: { modelValue: 2.375, step: 1, min: 0, max: 10 } });
    expect(w.text()).toContain('2.38');
    expect(w.text()).not.toContain('2.375');
    await w.setProps({ modelValue: 24.37 });
    expect(w.text()).toContain('24.37');
    expect(w.text()).not.toContain('24.370');
  });
});
