// The calendar file flow: read a file, show what is in it, and add it or update what an earlier copy added.
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { addDays, parseIcs, planIcsImport, updateFromFile } from '../upcoming';
import type { UpcomingItem } from '../upcoming';
import { dateIn } from '../upcoming/zone';
import { zone } from './upcomingShared';
import { examsStore, setExams, setTimetable, timetableStore } from './upcomingStores';
import styles from './tools.module.css';
import extra from './extra.module.css';

interface FileProps {
  items: readonly UpcomingItem[];
  onItems(next: UpcomingItem[]): void;
  setNote(text: string): void;
}

/** Reads a calendar file, shows what is in it, and adds it or updates what an earlier copy added. */
export function CalendarFile({ items, onItems, setNote }: FileProps) {
  const picker = useRef<HTMLInputElement>(null);
  const exams = useStore(examsStore, (value) => value);
  const slots = useStore(timetableStore, (value) => value);
  const [pending, setPending] = useState<{ source: string; plan: ReturnType<typeof planIcsImport> } | null>(null);
  const timetableOn = useFlag('tools.timetable');
  const examsOn = useFlag('tools.exams');
  const [use, setUse] = useState({ classes: true, exams: true, items: true });

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const calendar = parseIcs(await file.text());
      if (calendar.components.length === 0) throw new Error('empty');
      const today = dateIn(Date.now(), zone());
      const plan = planIcsImport(calendar, { from: addDays(today, -31), to: addDays(today, 365) }, zone(), file.name);
      setPending({ source: file.name, plan });
    } catch {
      setPending(null);
      setNote(t('smart.tools.upcoming.importFailed'));
    }
  };

  const known = pending
    ? [...items, ...exams, ...slots].some((one) => (one as { source?: string }).source === pending.source)
    : false;

  const apply = () => {
    if (!pending) return;
    const { plan, source } = pending;
    const results = {
      items: use.items ? updateFromFile(items, plan.items, source) : null,
      exams: use.exams && examsOn ? updateFromFile(exams, plan.exams, source) : null,
      classes: use.classes && timetableOn ? updateFromFile(slots, plan.classes, source) : null,
    };
    if (results.items) onItems(results.items.next);
    if (results.exams) setExams(results.exams.next);
    if (results.classes) setTimetable(results.classes.next);
    const added = (results.items?.added ?? 0) + (results.exams?.added ?? 0) + (results.classes?.added ?? 0);
    const removed = (results.items?.removed ?? 0) + (results.exams?.removed ?? 0) + (results.classes?.removed ?? 0);
    const text = known
      ? t('study.calendar.updated', { added, removed })
      : t('study.calendar.imported', { count: added });
    setNote(text);
    announce(text);
    setPending(null);
  };

  return (
    <>
      <Button variant="quiet" onClick={() => picker.current?.click()}>
        {t('smart.tools.upcoming.importFile')}
      </Button>
      <input ref={picker} type="file" accept=".ics,text/calendar" hidden onChange={(event) => void choose(event)} />
      {pending ? (
        <div className={styles.card} role="group" aria-label={t('study.calendar.found', { name: pending.source })}>
          <p>{t('study.calendar.found', { name: pending.source })}</p>
          {(
            [
              ['classes', pending.plan.classes.length],
              ['exams', pending.plan.exams.length],
              ['items', pending.plan.items.length],
            ] as const
          ).map(([key, count]) => (
            <label key={key} className={extra.day}>
              <input
                type="checkbox"
                checked={use[key]}
                disabled={count === 0 || (key === 'classes' && !timetableOn) || (key === 'exams' && !examsOn)}
                onChange={(event) => setUse({ ...use, [key]: event.target.checked })}
              />
              {t(`study.calendar.kinds.${key}`, { count })}
            </label>
          ))}
          <div className={styles.buttons}>
            <Button variant="primary" onClick={apply}>
              {known ? t('study.calendar.update') : t('study.calendar.import')}
            </Button>
            <Button variant="quiet" onClick={() => setPending(null)}>
              {t('study.edit.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
