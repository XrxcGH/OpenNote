// The form to add a class to the weekly timetable, and the list of classes to remove them from.
import { useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { clockText, minutesOfText } from '../upcoming';
import type { ClassSection, ClassSlot } from '../upcoming';
import { ClassTemplate } from './ClassTemplate';
import { useNodeChoices } from './nodeChoices';
import { WEEK, newId, weekday } from './upcomingShared';
import { setTimetable, timetableStore } from './upcomingStores';
import styles from './tools.module.css';
import extra from './extra.module.css';

export function ClassForm() {
  const slots = useStore(timetableStore, (value) => value);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('09:50');
  const [room, setRoom] = useState('');
  const [place, setPlace] = useState('');
  const choices = useNodeChoices().filter((one) => one.kind === 'section');
  const [problem, setProblem] = useState('');

  const add = () => {
    if (!name.trim() || days.length === 0 || Number.isNaN(minutesOfText(start)) || Number.isNaN(minutesOfText(end))) {
      return setProblem(t('study.timetable.needFields'));
    }
    setProblem('');
    const chosen = choices.find((one) => one.id === place);
    const section: ClassSection | null = chosen
      ? { id: chosen.id, label: chosen.label, notebookId: chosen.notebookId }
      : null;
    setTimetable([
      ...slots,
      {
        id: newId('k'),
        name: name.trim(),
        days: days as ClassSlot['days'],
        start,
        end,
        room: room.trim(),
        ...(section ? { section } : {}),
      },
    ]);
    setName('');
    setDays([]);
    setRoom('');
    setPlace('');
    announce(t('study.timetable.added'));
  };

  return (
    <>
      <h4 className={styles.groupTitle}>{t('study.timetable.add')}</h4>
      <TextField label={t('study.timetable.name')} value={name} onChange={setName} />
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
          <input type="time" className={extra.input} value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className={extra.field}>
          {t('study.timetable.end')}
          <input type="time" className={extra.input} value={end} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      <TextField label={t('study.timetable.room')} value={room} onChange={setRoom} />
      <label className={extra.field}>
        {t('study.timetable.section')}
        <select className={extra.input} value={place} onChange={(event) => setPlace(event.target.value)}>
          <option value="">{t('study.timetable.noSection')}</option>
          {choices.map((one) => (
            <option key={one.id} value={one.id}>
              {one.label}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.buttons}>
        <Button onClick={add}>{t('study.timetable.addButton')}</Button>
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
            {slot.section ? (
              <span className={styles.note}>{t('study.timetable.inSection', { section: slot.section.label })}</span>
            ) : null}
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
      <ClassTemplate />
    </>
  );
}
