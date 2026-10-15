// The two buttons beside a class that has a section: Open class, and Record. Open class makes the day's page from the
// class template if it is not there yet and goes to it. Record does the same and then asks for a recording; it is
// only ever asked for by pressing it, and the recorder keeps its own rules about the microphone.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import type { CivilDate, ClassSlot } from '../upcoming';
import { openClass, recordClass, recordOnShownPage } from './classActions';
import type { ClassOpening } from './classActions';
import styles from './tools.module.css';

function say(slot: ClassSlot, result: ClassOpening): string {
  if (result.ok) return t(result.made ? 'study.timetable.made' : 'study.timetable.opened', { name: slot.name });
  return t('study.timetable.sectionGone', { name: slot.name });
}

export function ClassButtons({ slot, date }: { slot: ClassSlot; date: CivilDate }) {
  const [note, setNote] = useState('');
  if (!slot.section) return null;
  const tell = (text: string) => {
    setNote(text);
    announce(text);
  };
  return (
    <>
      <Button
        variant="quiet"
        aria-label={t('study.timetable.openNamed', { name: slot.name })}
        onClick={() => void openClass(slot, date).then((result) => tell(say(slot, result)))}
      >
        {t('study.timetable.open')}
      </Button>
      <Button
        variant="quiet"
        aria-label={t('study.timetable.recordNamed', { name: slot.name })}
        onClick={() =>
          void recordClass(slot, date, async (page) => {
            const outcome = await recordOnShownPage(page);
            tell(
              t(
                outcome === 'started'
                  ? 'study.timetable.recordStarted'
                  : outcome === 'busy'
                    ? 'study.timetable.recordBusy'
                    : 'study.timetable.recordWaited',
                { name: slot.name },
              ),
            );
          }).then((result) => {
            if (!result.ok) tell(say(slot, result));
          })
        }
      >
        {t('study.timetable.record')}
      </Button>
      {note ? (
        <span className={styles.note} role="status">
          {note}
        </span>
      ) : null}
    </>
  );
}
