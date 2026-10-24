// Significant-figures mode: one switch the calculator and Math on page lines both read, kept on this device. When it
// is on, answers are rounded by the classroom rules and say which rule was used. The flag can hide the whole thing.
import { isEnabled } from '../../../app/flags';

const KEY = 'opennote.tools.sigfigs.mode';
const EVENT = 'opennote:sigfigs-mode';

/** True when the helper is on in this build and the person turned the mode on. */
export function sigFigMode(): boolean {
  if (!isEnabled('tools.sigfigs')) return false;
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSigFigMode(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // The choice lasts until the window closes.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** Calls `changed` when the mode changes here or in another window. Returns the way to stop. */
export function watchSigFigMode(changed: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) changed();
  };
  window.addEventListener(EVENT, changed);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, changed);
    window.removeEventListener('storage', onStorage);
  };
}
