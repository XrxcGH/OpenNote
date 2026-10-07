// The form to add an exam, and the list of exams to remove them from. An exam can be for a deck and for a notebook
// or a section, and the list says which.
import { useState } from 'react';
import { decksStore, setDeckExam } from '../../study';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { parseDateKey } from '../upcoming';
import type { Exam, ExamTarget } from '../upcoming';
import { useNodeChoices } from './nodeChoices';
import { newId } from './upcomingShared';
import { examsStore, setExams } from './upcomingStores';
import styles from './tools.module.css';
import extra from './extra.module.css';

export function ExamForm() {
  const exams = useStore(examsStore, (value) => value);
  const decks = useStore(decksStore, (value) => value);
  const choices = useNodeChoices();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [deck, setDeck] = useState('');
  const [place, setPlace] = useState('');
  const [problem, setProblem] = useState('');

  const add = () => {
    if (!name.trim() || !parseDateKey(date)) return setProblem(t('study.exams.needDate'));
    setProblem('');
    const chosen = choices.find((one) => one.id === place);
    const target: ExamTarget | null = chosen
      ? { kind: chosen.kind, id: chosen.id, label: chosen.label, notebookId: chosen.notebookId }
      : null;
    const exam: Exam = {
      id: newId('x'),
      name: name.trim(),
      date,
      time,
      ...(deck ? { deck } : {}),
      ...(target ? { target } : {}),
    };
    setExams([...exams, exam]);
    if (deck) setDeckExam(deck, date);
    setName('');
    setDate('');
    setTime('');
    setPlace('');
    announce(t('study.exams.added'));
  };
  const remove = (exam: Exam) => {
    setExams(exams.filter((one) => one.id !== exam.id));
    if (exam.deck) setDeckExam(exam.deck, null);
  };

  return (
    <>
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
      <label className={extra.field}>
        {t('study.exams.place')}
        <select className={extra.input} value={place} onChange={(event) => setPlace(event.target.value)}>
          <option value="">{t('study.exams.noPlace')}</option>
          {choices.map((one) => (
            <option key={one.id} value={one.id}>
              {one.label}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.buttons}>
        <Button onClick={add}>{t('study.exams.addButton')}</Button>
      </div>
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
      <ul className={styles.items}>
        {exams.map((exam) => (
          <li key={exam.id} className={styles.item}>
            <span className={styles.itemTitle}>
              {exam.name}
              {exam.target ? (
                <span className={styles.note}> {t('study.exams.for', { place: exam.target.label })}</span>
              ) : null}
            </span>
            <span className={styles.itemDue}>{exam.date}</span>
            <Button
              variant="quiet"
              aria-label={t('study.exams.remove', { name: exam.name })}
              onClick={() => remove(exam)}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
