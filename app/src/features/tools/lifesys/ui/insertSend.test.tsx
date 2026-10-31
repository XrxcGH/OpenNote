// Insert with no page caret to take the result shows a toast, not only a live-region message, so the first Insert
// after opening the window does not look as if it failed; with a page that takes it, no toast appears.
import { afterEach, describe, expect, it } from 'vitest';
import { INSERT_EVENT } from '../../flags';
import { toastStore } from '../../../../state/toasts';
import { send } from './insert';

const take = (event: Event) => ((event as CustomEvent<{ handled: boolean }>).detail.handled = true);

afterEach(() => {
  window.removeEventListener(INSERT_EVENT, take);
  toastStore.set({ current: null, queue: [] });
});

describe('inserting a life science result', () => {
  it('shows a toast asking for a click in the page when nothing takes the insert', () => {
    send({ text: 'Cardiac output: 4.9 L/min' });
    expect(toastStore.get().current?.message).toBe('Click in a page first, then insert.');
  });

  it('shows no toast when the page takes the insert', () => {
    window.addEventListener(INSERT_EVENT, take);
    send({ text: 'Cardiac output: 4.9 L/min' });
    expect(toastStore.get().current).toBeNull();
  });
});
