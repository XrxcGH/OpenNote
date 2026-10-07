// Forms to add an exam or a class, and the lists to remove them from.
import { useState } from 'react';
import { decksStore, setDeckExam } from '../../study';
import { useFlag } from '../../../app/flags';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { clockText, minutesOfText, parseDateKey } from '../upcoming';
import type { ClassSlot, Exam } from '../upcoming';
import { WEEK, newId, weekday } from './upcomingShared';
import { examsStore, setExams, setTimetable, timetableStore } from './upcomingStores';
import styles from './tools.module.css';
import extra from './extra.module.css';

/** Forms to add an exam or a class, and the lists to remove them from. */
export function Planner() {
  const exams = useStore(examsStore, (value) => value);
  const slots = useStore(timetableStore, (value) => value);
  const decks = useStore(decksStore, (value) => value);
  const showExams = useFlag('tools.exams');
  const showClasses = useFlag('tools.timetable');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [deck, setDeck] = useState('');
  const [className, setClassName] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('09:50');
  const [room, setRoom] = useState('');
  const [problem, setProblem] = useState('');

  const addExam = () => {
    if (!name.trim() || !parseDateKey(date)) return setProblem(t('study.exams.needDate'));
    setProblem('');
    const exam: Exam = { id: newId('x'), name: name.trim(), date, time, ...(deck ? { deck } : {}) };
    setExams([...exams, exam]);
    if (deck) setDeckExam(deck, date);
    setName('');
    setDate('');
    setTime('');
    announce(t('study.exams.added'));
  };
  const removeExam = (exam: Exam) => {
    setExams(exams.filter((one) => one.id !== exam.id));
    if (exam.deck) setDeckExam(exam.deck, null);
  };
  const addClass = () => {
    if (
      !className.trim() ||
      days.length === 0 ||
      Number.isNaN(minutesOfText(start)) ||
      Number.isNaN(minutesOfText(end))
    ) {
      return setProblem(t('study.timetable.needFields'));
    }
    setProblem('');
    setTimetable([
      ...slots,
      { id: newId('k'), name: className.trim(), days: days as ClassSlot['days'], start, end, room: room.trim() },
    ]);
    setClassName('');
    setDays([]);
    setRoom('');
    announce(t('study.timetable.added'));
  };

  return (
    <details className={styles.group}>
      <summary>{t('study.planner.summary')}</summary>
      <div className={styles.form}>
        {showExams ? (
          <>
            <h4 className={styles.groupTitle}>{t('study.exams.add')}</h4>
            <TextField label={t('study.exams.name')} value={name} onChange={setName} />
            <div className={extra.pair}>
              <label className={extra.field}>
                {t('study.exams.date')}
                <input
                  type="date"
                  className={extra.input}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className={extra.field}>
                {t('study.exams.time')}
                <input
                  type="time"
                  className={extra.input}
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
            </div>
            <label className={extra.field}>
              {t('study.exams.deck')}
              <select className={extra.input} value={deck} onChange={(event) => setDeck(event.target.value)}>
                <option value="">{t('study.exams.noDeck')}</option>
                {decks.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.buttons}>
              <Button onClick={addExam}>{t('study.exams.addButton')}</Button>
            </div>
            <ul className={styles.items}>
              {exams.map((exam) => (
                <li key={exam.id} className={styles.item}>
                  <span className={styles.itemTitle}>{exam.name}</span>
                  <span className={styles.itemDue}>{exam.date}</span>
                  <Button
                    variant="quiet"
                    aria-label={t('study.exams.remove', { name: exam.name })}
                    onClick={() => removeExam(exam)}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {showClasses ? (
          <>
            <h4 className={styles.groupTitle}>{t('study.timetable.add')}</h4>
            <TextField label={t('study.timetable.name')} value={className} onChange={setClassName} />
            <fieldset className={extra.days}>
              <legend>{t('study.timetable.days')}</legend>
              {WEEK.map((day) => (
                <label key={day} className={extra.day}>
                  <input
                    type="checkbox"
                    checked={days.includes(day)}
                    onChange={(event) =>
                      setDays(event.target.checked ? [...days, day] : days.filter((one) => one !== day))
                    }
                  />
                  {weekday(day)}
                </label>
              ))}
            </fieldset>
            <div className={extra.pair}>
              <label className={extra.field}>
                {t('study.timetable.start')}
                <input
                  type="time"
                  className={extra.input}
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label className={extra.field}>
                {t('study.timetable.end')}
                <input
                  type="time"
                  className={extra.input}
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
            </div>
            <TextField label={t('study.timetable.room')} value={room} onChange={setRoom} />
            <div className={styles.buttons}>
              <Button onClick={addClass}>{t('study.timetable.addButton')}</Button>
            </div>
          </>
        ) : null}
        {problem ? (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        ) : null}
        {showClasses ? (
          <ul className={styles.items}>
            {slots.map((slot) => (
              <li key={slot.id} className={styles.item}>
                <span className={styles.itemTitle}>{slot.name}</span>
                <span className={styles.itemDue}>
                  {slot.days.map(weekday).join(' ')} {clockText(minutesOfText(slot.start))}
                </span>
                <Button
                  variant="quiet"
                  aria-label={t('study.timetable.remove', { name: slot.name })}
                  onClick={() => setTimetable(slots.filter((one) => one.id !== slot.id))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
