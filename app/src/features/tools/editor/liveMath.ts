// Live math for the tools: the person's choices (state/liveMath.ts) with this build's flag, for the page lines'
// answers and solutions and for the switches in Settings.
import { isEnabled } from '../../../app/flags';
import { chooseLineAnswers, chooseLiveSolve, lineAnswersChosen, liveSolveChosen } from '../../../state/liveMath';

export { LIVE_MATH_EVENT } from '../../../state/liveMath';

/** Answers after the equals sign on page lines. */
export const lineAnswersOn = lineAnswersChosen;
export const setLineAnswersOn = chooseLineAnswers;

/** Solutions offered while an equation is written: built in this build, and not turned off. */
export const liveSolveOn = (): boolean => isEnabled('math.liveSolve') && liveSolveChosen();
export const setLiveSolveOn = chooseLiveSolve;
