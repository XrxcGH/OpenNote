// The toast queue (ARCHITECTURE.md section 15.5): one toast shows at a time, and the rest wait their turn.

import { createStore } from './store';

export interface ToastItem {
  readonly key: number;
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

export function enqueueToast(toast: Omit<ToastItem, 'key'>): ToastItem {
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
