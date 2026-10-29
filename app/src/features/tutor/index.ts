// The tutor's one public door (ADR 0050). The page imports it lazily, on the first tutor command or when Settings
// shows the switch, so none of this is in the start-up bundle.
export { askToTurnOnTutor, chooseTutor, tutorChosen, tutorOn } from './choice';
export { loadMathKit } from './kit';
export { TutorPanel } from './TutorPanel';
export { default as TutorSetting } from './TutorSetting';
export { endSession, explainMistake, nextHint, setContext, tutorState } from './session';
export type { Seed } from './session';
export { default as tutorStyles } from './tutor.module.css';
