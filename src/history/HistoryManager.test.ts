import { describe, expect, it, vi } from 'vitest';
import { HistoryManager } from './HistoryManager';
import { CompositeOperation, type Operation } from './operation';

interface Counter { value: number }

/** Sets `value` from `from` to `to`; same-key sets coalesce (first from, last to). */
class SetOp implements Operation<Counter> {
  readonly type = 'set';
  readonly description = 'Set';
  constructor(readonly from: number, readonly to: number, readonly coalesceKey?: string, readonly timestamp = Date.now()) {}
  coalesceWith(prev: Operation<Counter>): Operation<Counter> | null {
    return prev instanceof SetOp ? new SetOp(prev.from, this.to, this.coalesceKey, this.timestamp) : null;
  }
  apply(s: Counter): void { s.value = this.to; }
  unapply(s: Counter): void { s.value = this.from; }
}

function setup() {
  const state: Counter = { value: 0 };
  const h = new HistoryManager<Counter>();
  h.initialize(state);
  const set = (to: number, key?: string, at?: number) => { const op = new SetOp(state.value, to, key, at); op.apply(state); h.recordOperation(op); };
  return { state, h, set };
}

describe('HistoryManager', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    const { state, h, set } = setup();
    set(1); set(2);
    expect(h.undo()).toBe(true);
    expect(state.value).toBe(1);
    expect(h.redo()).toBe(true);
    expect(state.value).toBe(2);
    h.undo(); set(5);
    expect(h.canRedo()).toBe(false);
    h.undo();
    expect(state.value).toBe(1);
  });

  it('coalesces same-key edits inside the window, not across a gesture boundary or the window', () => {
    const { state, h, set } = setup();
    set(1, 'k', 1000); set(2, 'k', 1500); set(3, 'k', 1900);
    expect(h.getUndoStackSize()).toBe(1);
    h.finalizeActiveTransform();
    set(4, 'k', 2000);
    set(5, 'k', 3500); // > 1 s after the last record
    expect(h.getUndoStackSize()).toBe(3);
    h.undo(); h.undo(); h.undo();
    expect(state.value).toBe(0);
  });

  it('fires the mutation hook on record, coalesced record, undo and redo, but not on clear', () => {
    const { h, set } = setup();
    const hook = vi.fn();
    h.setMutationHook(hook);
    set(1, 'k', 1000); set(2, 'k', 1100); h.undo(); h.redo(); h.clear();
    expect(hook).toHaveBeenCalledTimes(4);
  });

  it('caps the stack, drops the oldest on request and reports descriptions', () => {
    const state: Counter = { value: 0 };
    const h = new HistoryManager<Counter>({ maxHistorySize: 3 });
    h.initialize(state);
    for (let i = 1; i <= 5; i++) h.recordOperation(new SetOp(i - 1, i));
    expect(h.getUndoStackSize()).toBe(3);
    expect(h.dropOldest()).toBe(true);
    expect(h.getUndoStackSize()).toBe(2);
    expect(h.getLastOperationDescription()).toBe('Set');
    h.undo();
    expect(h.getRedoDescription()).toBe('Set');
  });

  it('stamps the camera on record and on each coalesced update', () => {
    const { h, set } = setup();
    let x = 0;
    h.setCameraSnapshotProvider(() => ({ position: [x, 0, 0], target: [0, 0, 0], projection: 'perspective', zoom: 1 }));
    set(1, 'k', 1000);
    x = 7;
    set(2, 'k', 1100);
    expect(h.getLastOperation()?.camera?.position[0]).toBe(7);
  });

  it('runs composites in order and unapplies in reverse', () => {
    const { state, h } = setup();
    const op = new CompositeOperation<Counter>([new SetOp(0, 1), new SetOp(1, 2)]);
    op.apply(state);
    h.recordOperation(op);
    h.undo();
    expect(state.value).toBe(0);
  });
});
