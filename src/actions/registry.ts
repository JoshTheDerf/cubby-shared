/**
 * Action registry. Actions are always registered and gated with `when`;
 * surfaces never add or remove commands per session. `registerActions` returns
 * a disposer (tests, hot reload, areas that contribute their own actions).
 */
export interface ActionRegistry<A extends { id: string }> {
  /** Register a batch. Returns a disposer removing exactly these (if still live). */
  registerActions(list: A[]): () => void;
  getAction(id: string): A | undefined;
  /** Live snapshot in registration order (the dispatcher's first-match tie-breaker). */
  getAllActions(): A[];
  /** Test / hot-reload escape hatch. */
  clearActions(): void;
}

/** `onChange` fires after every add / remove (e.g. to bump a reactive revision). */
export function createActionRegistry<A extends { id: string }>(onChange?: () => void): ActionRegistry<A> {
  const registry = new Map<string, A>();
  return {
    registerActions(list) {
      for (const a of list) {
        if (registry.has(a.id)) console.warn(`[actions] overwriting existing action "${a.id}"`);
        registry.set(a.id, a);
      }
      onChange?.();
      return () => {
        let changed = false;
        for (const a of list) if (registry.get(a.id) === a) { registry.delete(a.id); changed = true; }
        if (changed) onChange?.();
      };
    },
    getAction: (id) => registry.get(id),
    getAllActions: () => Array.from(registry.values()),
    clearActions() { registry.clear(); onChange?.(); },
  };
}
