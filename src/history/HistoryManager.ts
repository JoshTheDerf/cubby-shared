import type { Operation } from './operation';
import type { CameraSnapshot } from './cameraSnapshot';

export type HistoryChangeCallback = (canUndo: boolean, canRedo: boolean) => void;

/**
 * Undo/redo stack shared by CubbyCAD and CubbySlicer. Parameterized on the
 * state the operations work against (CubbyCAD's `Scene`, its voxel session,
 * the slicer's project); each editor instantiates its own manager.
 */
export class HistoryManager<TState> {
  private undoStack: Operation<TState>[] = [];
  private redoStack: Operation<TState>[] = [];
  private maxHistorySize: number = 100;
  private currentScene: TState | null = null;
  private onChangeCallbacks: HistoryChangeCallback[] = [];
  private isApplyingHistory: boolean = false;

  // Generic coalescing: an op opts in via `coalesceKey` + `coalesceWith`.
  // We only merge when the immediate-top of the undo stack shares the same
  // key AND the previous record happened within COALESCE_WINDOW_MS. The
  // time window prevents two unrelated user gestures on the same object
  // (e.g. paint it red, do something else, paint it blue) from collapsing
  // into a single undo step.
  private lastCoalesceKey: string | null = null;
  private lastCoalesceTime: number = 0;
  private static readonly COALESCE_WINDOW_MS = 1000;

  /**
   * Fired every time the DOCUMENT changes through this manager: an op recorded
   * (including a coalesced mid-gesture update), an undo, a redo. NOT on
   * `initialize`/`clear` (loading a part is not an edit).
   *
   * Why here: "unsaved changes" used to be an event every mutation site had to
   * remember to fire (`notifySceneChanged` / `markDocumentDirty`, ~45 sites).
   * Any site that recorded an undo step but forgot the notify — or notified
   * before the mutation — left the document changed while the save indicator
   * said "All changes saved" and autosave slept; that lost work. Every
   * undoable change goes through here, so this is the one place that cannot
   * be forgotten. The bridge wires it to `markDocumentDirty`.
   */
  private mutationHook: (() => void) | null = null;
  setMutationHook(fn: (() => void) | null): void { this.mutationHook = fn; }
  private noteMutation(): void { this.mutationHook?.(); }

  /**
   * Camera-pose provider. Every recorded op is stamped with the camera pose
   * at record time (`op.camera`) so a build replay can retrace the author's
   * viewpoints. Never consulted by undo/redo. The Renderer registers it.
   */
  private cameraProvider: (() => CameraSnapshot | null) | null = null;
  setCameraSnapshotProvider(fn: (() => CameraSnapshot | null) | null): void { this.cameraProvider = fn; }
  private stampCamera(op: Operation<TState>): void {
    if (!this.cameraProvider) return;
    const snap = this.cameraProvider();
    if (snap) op.camera = snap;
  }

  constructor(options?: { maxHistorySize?: number }) {
    if (options?.maxHistorySize) {
      this.maxHistorySize = options.maxHistorySize;
    }
  }

  initialize(scene: TState): void {
    // Hold the LIVE reference, not a clone. Operations apply/unapply by
    // mutating this scene in place; callers (Renderer, contour API) keep
    // their own references that point to the same object, so mutations
    // stay visible everywhere. The prior deep-clone caused undo to operate
    // on a frozen snapshot and then clobber the live state on rebuild.
    this.currentScene = scene;
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.lastCoalesceTime = 0;
    this.notifyChange();
  }

  getCurrentScene(): TState | null {
    return this.currentScene;
  }

  updateCurrentScene(scene: TState): void {
    this.currentScene = scene;
  }

  recordOperation(operation: Operation<TState>, _immediate: boolean = false): void {
    if (this.isApplyingHistory) return;

    const key = operation.coalesceKey;
    const now = operation.timestamp;

    if (
      key != null &&
      this.lastCoalesceKey === key &&
      now - this.lastCoalesceTime < HistoryManager.COALESCE_WINDOW_MS &&
      this.undoStack.length > 0 &&
      typeof operation.coalesceWith === 'function'
    ) {
      const top = this.undoStack[this.undoStack.length - 1];
      if (top.coalesceKey === key) {
        const merged = operation.coalesceWith(top);
        if (merged) {
          // The gesture is still going — the camera pose at its END is the one
          // the replay should show, so re-stamp on every coalesced update.
          this.stampCamera(merged);
          // Mid-gesture update: replace the top entry in place. Undo/redo
          // availability hasn't changed so we skip notifyChange — this path
          // fires every pointer/slider tick and rebuilding reactive history
          // bindings 60+ Hz is wasted work.
          this.undoStack[this.undoStack.length - 1] = merged;
          this.lastCoalesceTime = now;
          this.redoStack = [];
          this.noteMutation();
          return;
        }
      }
    }

    this.commitOperation(operation, key, now);
  }

  /**
   * Force the next op to start a fresh history entry even if it would
   * otherwise coalesce with the top of the stack. Called at gesture
   * boundaries (drag end, modal close) so two separate user actions on
   * the same object don't collapse into one undo step.
   */
  finalizeActiveTransform(): void {
    this.lastCoalesceKey = null;
  }

  private commitOperation(operation: Operation<TState>, key: string | undefined, now: number): void {
    this.stampCamera(operation);
    this.undoStack.push(operation);

    while (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this.redoStack = [];
    this.lastCoalesceKey = key ?? null;
    this.lastCoalesceTime = now;
    this.notifyChange();
    this.noteMutation();
  }

  undo(): boolean {
    this.finalizeActiveTransform();

    if (this.undoStack.length === 0 || !this.currentScene) return false;

    const operation = this.undoStack.pop()!;
    operation.unapply(this.currentScene);
    this.redoStack.push(operation);

    this.notifyChange();
    this.noteMutation();
    return true;
  }

  redo(): boolean {
    this.finalizeActiveTransform();

    if (this.redoStack.length === 0 || !this.currentScene) return false;

    const operation = this.redoStack.pop()!;
    operation.apply(this.currentScene);
    this.undoStack.push(operation);

    this.notifyChange();
    this.noteMutation();
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  getRedoStackSize(): number {
    return this.redoStack.length;
  }

  getLastOperationDescription(): string | null {
    if (this.undoStack.length > 0) {
      return this.undoStack[this.undoStack.length - 1].description;
    }
    return null;
  }

  getRedoDescription(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].description : null;
  }

  /** Drop the oldest undo entry (e.g. under memory pressure). False when there is none. */
  dropOldest(): boolean {
    if (this.undoStack.shift() === undefined) return false;
    this.notifyChange();
    return true;
  }

  getLastOperation(): Operation<TState> | null {
    if (this.undoStack.length > 0) {
      return this.undoStack[this.undoStack.length - 1];
    }
    return null;
  }

  getUndoOperations(): Operation<TState>[] {
    return [...this.undoStack];
  }

  /**
   * Replace the undo stack with a restored set of operations (oldest→newest),
   * as loaded from a persisted document. The current scene is assumed to ALREADY
   * be at the post-replay state these ops describe (i.e. the saved scene is the
   * result of applying them) — so we do NOT re-apply: we simply seat them on the
   * undo stack so `getUndoOperations()` (the replay video), `undo()`, and a
   * subsequent `redo()` all work exactly as in the authoring session. The redo
   * stack is cleared (you can't redo past a freshly-opened state) and coalescing
   * state is reset so the next live edit starts a fresh entry.
   *
   * Bounded the same way `commitOperation` bounds growth, so a stale file that
   * somehow over-stuffed the blob can't blow past `maxHistorySize`.
   */
  restore(operations: Operation<TState>[]): void {
    this.undoStack = operations.slice(-this.maxHistorySize);
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.lastCoalesceTime = 0;
    this.notifyChange();
  }

  getRedoOperations(): Operation<TState>[] {
    return [...this.redoStack];
  }

  onChange(callback: HistoryChangeCallback): void {
    this.onChangeCallbacks.push(callback);
    callback(this.canUndo(), this.canRedo());
  }

  offChange(callback: HistoryChangeCallback): void {
    const index = this.onChangeCallbacks.indexOf(callback);
    if (index !== -1) {
      this.onChangeCallbacks.splice(index, 1);
    }
  }

  private notifyChange(): void {
    const canUndo = this.canUndo();
    const canRedo = this.canRedo();
    for (const callback of this.onChangeCallbacks) {
      callback(canUndo, canRedo);
    }
  }

  setApplyingHistory(value: boolean): void {
    this.isApplyingHistory = value;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
    this.lastCoalesceTime = 0;
    this.notifyChange();
  }

  dispose(): void {
    this.clear();
    this.onChangeCallbacks = [];
    this.currentScene = null;
  }
}
