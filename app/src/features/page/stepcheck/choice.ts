// Whether Check my work is offered: this build's flag, and the person's switch in Settings, then Editing. On until
// turned off. Kept in the browser's storage for the app; a blocked storage keeps it on.
import { isEnabled } from '../../../app/flags';

const KEY = 'opennote.math.checkWork';

export function checkWorkChosen(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function chooseCheckWork(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // The choice lasts until the window closes.
  }
}

/** Built in this build, and not turned off. */
export const checkWorkOn = (): boolean => isEnabled('math.checkWork') && checkWorkChosen();
