// The toast queue (ARCHITECTURE.md section 15.5): one toast shows at a time, and the rest wait their turn.
// A toast with an id replaces a showing or waiting toast with the same id. A gesture that repeats, such as
// erasing strokes, then updates one toast instead of queueing one per gesture.

import { createStore } from './store';

export interface ToastItem {
  /** Identifies this toast to its `dismiss` handle. A replacement keeps the key of the toast it replaces. */
  readonly key: number;
  readonly id?: string;
  readonly message: string;
  readonly announce?: string;
  readonly action?: { label: string; run(): void | Promise<void> };
  readonly tone?: 'neutral' | 'danger';
}

export const toastStore = createStore<{ current: ToastItem | null; queue: readonly ToastItem[] }>(
  { current: null, queue: [] },
  'toasts',
);

let nextKey = 1;

/** Shows the toast now, replaces the toast with its id, or queues it behind the one showing. */
export function enqueueToast(toast: Omit<ToastItem, 'key'>): ToastItem {
  const { current, queue } = toastStore.get();
  const match =
    toast.id === undefined ? undefined : [current, ...queue].find((item) => item !== null && item.id === toast.id);
  if (match) {
    const item = { ...toast, key: match.key };
    toastStore.set((state) => ({
      current: state.current?.key === match.key ? item : state.current,
      queue: state.queue.map((entry) => (entry.key === match.key ? item : entry)),
    }));
    return item;
  }
  const item = { ...toast, key: nextKey++ };
  toastStore.set((state) =>
    state.current ? { ...state, queue: [...state.queue, item] } : { current: item, queue: state.queue },
  );
  return item;
}

export function dismissToast(key: number): void {
  toastStore.set((state) => {
    if (state.current?.key === key) return { current: state.queue[0] ?? null, queue: state.queue.slice(1) };
    return { ...state, queue: state.queue.filter((item) => item.key !== key) };
  });
}

/** Clears the showing toast and the queue, for tests and for leaving a notebook. */
export function clearToasts(): void {
  toastStore.set({ current: null, queue: [] });
}
