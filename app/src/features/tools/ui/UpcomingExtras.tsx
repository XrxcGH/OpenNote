// The parts of Upcoming that came with the study tools: today's classes and the next one, exam countdowns, forms
// for exams and classes, the calendar file flow with "Update from this file", and the reminders switch. A
// countdown is a plain number of days: no colors that grow urgent, no alarms.
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { decksStore, setDeckExam } from '../../study';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, Switch, TextField, announce } from '../../../ui';
import {
  addDays,
  classesOn,
  clockText,
  daysLeft,
  examsAhead,
  minutesOfText,
  nextClass,
  parseDateKey,
  parseIcs,
  planIcsImport,
  updateFromFile,
} from '../upcoming';
import type { ClassSlot, Exam, UpcomingItem } from '../upcoming';
import { dateIn } from '../upcoming/zone';
import { disableReminders, enableReminders, remindersOn } from './notify';
import { examsStore, setExams, setTimetable, timetableStore } from './upcomingStores';
import styles from './tools.module.css';
import extra from './extra.module.css';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const weekday = (day: number): string => new Date(2023, 0, 1 + day).toLocaleDateString(undefined, { weekday: 'short' });
const longDay = (day: number): string => new Date(2023, 0, 1 + day).toLocaleDateString(undefined, { weekday: 'long' });
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
let counter = 0;
const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

/** The time now, renewed each minute, so the lists move on at midnight and as classes begin. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Today's classes, the next one, and the exams that are still ahead. */
export function Overview() {
  const slots = useStore(timetableStore, (value) => value);
  const exams = useStore(examsStore, (value) => value);
  const decks = useStore(decksStore, (value) => value);
  const now = useMinute();
  const today = dateIn(now, zone());
  const linked = new Set(exams.map((exam) => exam.deck).filter(Boolean));
  const all: Exam[] = [
    ...exams,
    ...decks
      .filter((deck) => deck.exam && !linked.has(deck.id))
      .map((deck): Exam => ({ id: `deck:${deck.id}`, name: deck.name, date: deck.exam!, time: '' })),
  ];
  const ahead = examsAhead(all, today);
  const classes = classesOn(slots, today);
  const next = nextClass(slots, now, zone());
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

/** Forms to add an exam or a class, and the lists to remove them from. */
export function Planner() {
  const exams = useStore(examsStore, (value) => value);
  const slots = useStore(timetableStore, (value) => value);
  const decks = useStore(decksStore, (value) => value);
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
        <h4 className={styles.groupTitle}>{t('study.exams.add')}</h4>
        <TextField label={t('study.exams.name')} value={name} onChange={setName} />
        <div className={extra.pair}>
          <label className={extra.field}>
            {t('study.exams.date')}
            <input type="date" className={extra.input} value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className={extra.field}>
            {t('study.exams.time')}
            <input type="time" className={extra.input} value={time} onChange={(event) => setTime(event.target.value)} />
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
        <h4 className={styles.groupTitle}>{t('study.timetable.add')}</h4>
        <TextField label={t('study.timetable.name')} value={className} onChange={setClassName} />
        <fieldset className={extra.days}>
          <legend>{t('study.timetable.days')}</legend>
          {WEEK.map((day) => (
            <label key={day} className={extra.day}>
              <input
                type="checkbox"
                checked={days.includes(day)}
                onChange={(event) => setDays(event.target.checked ? [...days, day] : days.filter((one) => one !== day))}
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
            <input type="time" className={extra.input} value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>
        <TextField label={t('study.timetable.room')} value={room} onChange={setRoom} />
        <div className={styles.buttons}>
          <Button onClick={addClass}>{t('study.timetable.addButton')}</Button>
        </div>
        {problem ? (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        ) : null}
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
      </div>
    </details>
  );
}

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
      exams: use.exams ? updateFromFile(exams, plan.exams, source) : null,
      classes: use.classes ? updateFromFile(slots, plan.classes, source) : null,
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
                disabled={count === 0}
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

/** The switch for Windows notifications. They are off until asked for. */
export function RemindersSwitch() {
  const [on, setOn] = useState(remindersOn);
  const [blocked, setBlocked] = useState(false);
  return (
    <div className={styles.form}>
      <Switch
        label={t('study.reminders.label')}
        checked={on}
        onChange={async (next) => {
          if (!next) {
            disableReminders();
            setOn(false);
            return;
          }
          const granted = await enableReminders();
          setOn(granted);
          setBlocked(!granted);
        }}
      />
      {blocked ? <p className={styles.note}>{t('study.reminders.blocked')}</p> : null}
    </div>
  );
}
