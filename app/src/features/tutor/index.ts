// The tutor's one public door (ADR 0050). The page imports it lazily, on the first tutor command or when Settings
// shows the switch, so none of this is in the start-up bundle. The door itself is small: the turn-on choice and the
// switch. The panel, its session, and the guard load with `loadTutorPanel`, once the tutor is on.
export { askToTurnOnTutor, chooseTutor, tutorChosen, tutorOn } from './choice';
export { default as TutorSetting } from './TutorSetting';
export type { Seed } from './session';

export type TutorPanelModule = typeof import('./panel');

/** The panel, its session, and the math kit loader. */
export const loadTutorPanel = (): Promise<TutorPanelModule> => import('./panel');
