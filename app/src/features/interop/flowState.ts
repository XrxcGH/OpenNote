// A tiny observable for one dialog's state. A flow is made when its dialog opens and dropped when it closes, so
// it is not one of the app's named stores (those live for the whole session).

export interface FlowState<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createFlowState<T>(initial: T): FlowState<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = next;
      [...listeners].forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

let counter = 0;

/** A job name that no other running job has. */
export function newJobName(kind: 'import' | 'check' | 'export'): string {
  counter += 1;
  return `${kind}-${Date.now().toString(36)}-${counter}`;
}
