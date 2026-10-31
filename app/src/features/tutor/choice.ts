// Whether the tutor is on: this build's flag, and the person's own choice. The tutor is opt-in, so it starts off; a
// tutor command asks once to turn it on, and Settings, then Editing, has the switch. Kept in the browser's storage;
// a blocked storage keeps the choice until the window closes.
import { isEnabled } from '../../app/flags';
import { t } from '../../strings/t';
import { confirm } from '../../ui';

const KEY = 'opennote.tutor';
let fallback: boolean | null = null;

export function tutorChosen(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return fallback ?? false;
  }
}

export function chooseTutor(on: boolean): void {
  fallback = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // The choice lasts until the window closes.
  }
}

/** Built in this build, and turned on by the person. */
export const tutorOn = (): boolean => isEnabled('study.tutor') && tutorChosen();

/** True when the tutor is on, or the person turns it on now. */
export async function askToTurnOnTutor(): Promise<boolean> {
  if (!isEnabled('study.tutor')) return false;
  if (tutorChosen()) return true;
  const yes = await confirm({
    title: t('tutor.turnOn.title'),
    body: t('tutor.turnOn.body'),
    confirmLabel: t('tutor.turnOn.confirm'),
    cancelLabel: t('tutor.turnOn.cancel'),
  });
  if (yes) chooseTutor(true);
  return yes;
}
