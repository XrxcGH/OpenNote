// The person's choices for live math, from Settings, then Editing: answers after the equals sign on page lines, and
// solutions offered as an equation is written (on page lines and beside equations). Both are on until turned off.
// They are kept in the browser's storage for the app, and every open editor follows a change at once.
import { isEnabled } from '../../../app/flags';

const ANSWERS = 'opennote.math.lineAnswers';
const SOLVE = 'opennote.math.liveSolve';
/** The event an open editor listens for to redraw its answers. */
export const LIVE_MATH_EVENT = 'opennote:live-math';

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function write(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // The choice lasts until the window closes.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIVE_MATH_EVENT));
}

/** Answers after the equals sign on page lines. */
export const lineAnswersOn = (): boolean => read(ANSWERS);
export const setLineAnswersOn = (on: boolean): void => write(ANSWERS, on);

/** Solutions offered while an equation is written: built in this build, and not turned off. */
export const liveSolveOn = (): boolean => isEnabled('math.liveSolve') && read(SOLVE);
export const setLiveSolveOn = (on: boolean): void => write(SOLVE, on);
