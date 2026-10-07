// The pen and touch gestures in the shortcut list: scribble to erase, circle and tap, and the two- and three-finger
// double taps, each with whether it is on now. They are turned on and off in Settings, Pen and touch, so the table
// links there instead of offering a switch of its own.

import { navigate } from '../../app/location';
import { useSettings } from '../../state/settings';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { Button } from '../../ui';
import styles from './ShortcutList.module.css';

export type GestureId = 'scribbleErase' | 'circleSelect' | 'twoFingerUndo' | 'threeFingerRedo';

export interface GestureRow {
  readonly id: GestureId;
  readonly name: MessageKey;
  readonly how: MessageKey;
}

/** The gestures in the order Settings lists them. */
export const GESTURE_ROWS: readonly GestureRow[] = [
  { id: 'scribbleErase', name: 'ink.gestures.scribbleErase', how: 'shortcuts.gestures.scribbleHow' },
  { id: 'circleSelect', name: 'ink.gestures.circleSelect', how: 'shortcuts.gestures.circleHow' },
  { id: 'twoFingerUndo', name: 'ink.gestures.twoFingerUndo', how: 'shortcuts.gestures.twoFingerHow' },
  { id: 'threeFingerRedo', name: 'ink.gestures.threeFingerRedo', how: 'shortcuts.gestures.threeFingerHow' },
];

/** Settings, Pen and touch, where the gestures are turned on and off. Closes the shortcut dialog first. */
export function openPenSettings(): void {
  closeOverlay();
  navigate({ view: 'settings', section: 'penAndTouch' });
}

export function GesturesTable() {
  const gestures = useSettings((settings) => settings.ink.gestures);
  return (
    <>
      <p className={styles.note}>{t('shortcuts.gestures.description')}</p>
      <table aria-label={t('shortcuts.gestures.title')} className={styles.table}>
        <thead className={styles.visuallyHidden}>
          <tr>
            <th scope="col">{t('shortcuts.gestures.gestureColumn')}</th>
            <th scope="col">{t('shortcuts.gestures.howColumn')}</th>
            <th scope="col">{t('shortcuts.gestures.stateColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {GESTURE_ROWS.map((row) => (
            <tr key={row.id} data-gesture={row.id}>
              <th scope="row" className={styles.name}>
                {t(row.name)}
              </th>
              <td>{t(row.how)}</td>
              <td>{t(gestures[row.id] ? 'shortcuts.gestures.on' : 'shortcuts.gestures.off')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="quiet" onClick={openPenSettings}>
        {t('shortcuts.gestures.openSettings')}
      </Button>
    </>
  );
}
