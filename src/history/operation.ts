import type { CameraSnapshot } from './cameraSnapshot';

/**
 * Base interface for all editing operations.
 *
 * `coalesceKey` + `coalesceWith` opt an op into history batching: when the
 * top of the undo stack shares the same key and the time window hasn't
 * elapsed, HistoryManager replaces the top entry with the result of
 * `coalesceWith(prev)` instead of pushing a new entry. The convention is
 * `${type}:${id}` so only same-object + same-type ops batch together.
 */
export interface Operation<TState> {
  readonly type: string;
  readonly timestamp: number;
  readonly description: string;
  readonly coalesceKey?: string;
  coalesceWith?(prev: Operation<TState>): Operation<TState> | null;

  /**
   * Where the camera was when this entry was recorded (stamped by the
   * HistoryManager when a camera provider is set). REPLAY-ONLY metadata:
   * undo/redo never read it and never move the camera. Mutable because a
   * coalesced gesture keeps updating it to the pose at the END of the gesture.
   */
  camera?: CameraSnapshot;

  apply(state: TState): void;
  unapply(state: TState): void;
}

/** Composite operation for batching multiple operations together. */
export class CompositeOperation<TState> implements Operation<TState> {
  readonly type = 'composite';
  readonly timestamp: number;
  readonly description: string;
  camera?: CameraSnapshot;

  constructor(
    public readonly operations: Operation<TState>[],
    description?: string
  ) {
    this.timestamp = Date.now();
    this.description = description || `Batch of ${operations.length} operations`;
  }

  apply(state: TState): void {
    for (const op of this.operations) op.apply(state);
  }

  unapply(state: TState): void {
    for (let i = this.operations.length - 1; i >= 0; i--) this.operations[i].unapply(state);
  }
}
