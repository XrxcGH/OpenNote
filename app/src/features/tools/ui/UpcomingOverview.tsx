// Today's classes, the next one, and the exam countdowns at the top of Upcoming. A countdown is a plain number of days.
import { decksStore } from '../../study';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { classesOn, daysLeft, examsAhead, nextClass } from '../upcoming';
import type { Exam } from '../upcoming';
import { dateIn } from '../upcoming/zone';
import { longDay, useMinute, zone } from './upcomingShared';
import { examsStore, timetableStore } from './upcomingStores';
import styles from './tools.module.css';

/** Today's classes, the next one, and the exams that are still ahead. */
export function Overview() {
  const slots = useStore(timetableStore, (value) => value);
  const exams = useStore(examsStore, (value) => value);
  const decks = useStore(decksStore, (value) => value);
  const showClasses = useFlag('tools.timetable');
  const showExams = useFlag('tools.exams');
  const now = useMinute();
  const today = dateIn(now, zone());
  const linked = new Set(exams.map((exam) => exam.deck).filter(Boolean));
  const all: Exam[] = [
    ...exams,
    ...decks
      .filter((deck) => deck.exam && !linked.has(deck.id))
      .map((deck): Exam => ({ id: `deck:${deck.id}`, name: deck.name, date: deck.exam!, time: '' })),
  ];
  const ahead = showExams ? examsAhead(all, today) : [];
  const classes = showClasses ? classesOn(slots, today) : [];
  const next = showClasses ? nextClass(slots, now, zone()) : null;
  return (
    <>
      {classes.length > 0 || next ? (
        <section aria-labelledby="up-classes" className={styles.group}>
          <h3 id="up-classes" className={styles.groupTitle}>
            {t('study.timetable.today')}
          </h3>
          {classes.length === 0 ? <p className={styles.empty}>{t('study.timetable.noneToday')}</p> : null}
          <ul className={styles.items}>
            {classes.map((slot) => (
              <li key={slot.id} className={styles.item}>
                <span className={styles.itemTitle}>{slot.name}</span>
                <span className={styles.itemDue}>
                  {slot.start}–{slot.end}
                  {slot.room ? `, ${slot.room}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {next ? (
            <p className={styles.note}>
              {t('study.timetable.next', {
                name: next.slot.name,
                day:
                  next.date.day === today.day && next.date.month === today.month
                    ? t('study.timetable.today')
                    : longDay(new Date(next.date.year, next.date.month - 1, next.date.day).getDay()),
                time: next.slot.start,
              })}
            </p>
          ) : null}
        </section>
      ) : null}
      {ahead.length > 0 ? (
        <section aria-labelledby="up-exams" className={styles.group}>
          <h3 id="up-exams" className={styles.groupTitle}>
            {t('study.exams.title')}
          </h3>
          <ul className={styles.items}>
            {ahead.map((exam) => (
              <li key={exam.id} className={styles.item}>
                <span className={styles.itemTitle}>{exam.name}</span>
                <span className={styles.itemDue}>{t('study.exams.daysLeft', { count: daysLeft(exam, today) })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
