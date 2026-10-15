// Whether print and export turn study tape into blanks with an answer key. The choice is remembered on this device.
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';

const KEY = 'opennote.export.tapeBlanks';

export function tapeBlanksOn(): boolean {
  if (!isEnabled('study.tapeBlanks')) return false;
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTapeBlanks(on: boolean): void {
  try {
    localStorage.setItem(KEY, String(on));
  } catch {
    // The choice just is not remembered.
  }
}

/** Turns the choice over and says which way it went. */
export function toggleTapeBlanks(): void {
  const next = !tapeBlanksOn();
  setTapeBlanks(next);
  const message = t(next ? 'pagesPlus.tape.on' : 'pagesPlus.tape.off');
  showToast({ message });
  announce(message);
}
