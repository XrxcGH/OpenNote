// The person's choices for live math, from Settings, then Editing: answers after the equals sign on page lines, and
// solutions offered as an equation is written. Both are on until turned off. They are kept in the browser's storage
// for the app, and every open editor follows a change at once. The tools and the equations both read them, so they
// live here rather than in either feature.

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
export const lineAnswersChosen = (): boolean => read(ANSWERS);
export const chooseLineAnswers = (on: boolean): void => write(ANSWERS, on);

/** Solutions offered while an equation is written, as the person chose; the feature's flag is checked by callers. */
export const liveSolveChosen = (): boolean => read(SOLVE);
export const chooseLiveSolve = (on: boolean): void => write(SOLVE, on);
