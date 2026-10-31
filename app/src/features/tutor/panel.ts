// The tutor's heavier half (ADR 0050): the panel, its session, and the math kit loader. The door (index.ts) loads it
// with `loadTutorPanel`, after the person has turned the tutor on, so the turn-on question never waits for it.
export { loadMathKit } from './kit';
export { TutorPanel } from './TutorPanel';
export { endSession, explainMistake, nextHint, setContext, tutorState } from './session';
export { default as tutorStyles } from './tutor.module.css';
