// The settings of a practice exam: its name, how many questions, the difficulty, the question types, and the timer
// with its reminders. Every field has a label, and the form says what to fix before it makes the exam.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { cleanSettings } from '../../exam/basics';
import { examModelOn } from '../../exam/request';
import type { ExamRequest } from '../../exam/request';
import { parseReminders } from '../../exam/timer';
import { DEFAULT_SETTINGS, MAX_MINUTES, MAX_QUESTIONS, QUESTION_KINDS } from '../../exam/types';
import type { Difficulty, ExamSettings, QuestionKind } from '../../exam/types';
import styles from '../study.module.css';
import own from './exam.module.css';

const KIND_LABEL: Record<QuestionKind, MessageKey> = {
  short: 'exams.kind.short',
  choice: 'exams.kind.choice',
  fill: 'exams.kind.fill',
  worked: 'exams.kind.worked',
  truefalse: 'exams.kind.truefalse',
};

const DIFFICULTY_LABEL: Record<Difficulty, MessageKey> = {
  easier: 'exams.setup.easier',
  standard: 'exams.setup.standard',
  harder: 'exams.setup.harder',
};

interface Form {
  title: string;
  length: string;
  difficulty: Difficulty;
  kinds: QuestionKind[];
  timed: boolean;
  minutes: string;
  reminders: string;
}

interface PartProps {
  form: Form;
  change(part: Partial<Form>): void;
}

function SizeFields({ form, change }: PartProps) {
  return (
    <div className={own.pair}>
      <label className={styles.field}>
        {t('exams.setup.length')}
        <input
          type="number"
          min={1}
          max={MAX_QUESTIONS}
          value={form.length}
          onChange={(event) => change({ length: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        {t('exams.setup.difficulty')}
        <select value={form.difficulty} onChange={(event) => change({ difficulty: event.target.value as Difficulty })}>
          {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((one) => (
            <option key={one} value={one}>
              {t(DIFFICULTY_LABEL[one])}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function KindFields({ form, change }: PartProps) {
  return (
    <fieldset className={own.fieldset}>
      <legend>{t('exams.setup.kinds')}</legend>
      {QUESTION_KINDS.map((kind) => (
        <label key={kind} className={own.check}>
          <input
            type="checkbox"
            checked={form.kinds.includes(kind)}
            onChange={(event) =>
              change({ kinds: event.target.checked ? [...form.kinds, kind] : form.kinds.filter((one) => one !== kind) })
            }
          />
          {t(KIND_LABEL[kind])}
        </label>
      ))}
    </fieldset>
  );
}

function TimerFields({ form, change }: PartProps) {
  return (
    <fieldset className={own.fieldset}>
      <legend>{t('exams.setup.timer')}</legend>
      <label className={own.check}>
        <input type="checkbox" checked={form.timed} onChange={(event) => change({ timed: event.target.checked })} />
        {t('exams.setup.timed')}
      </label>
      {form.timed ? (
        <div className={own.pair}>
          <label className={styles.field}>
            {t('exams.setup.minutes')}
            <input
              type="number"
              min={1}
              max={MAX_MINUTES}
              value={form.minutes}
              onChange={(event) => change({ minutes: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            {t('exams.setup.reminders')}
            <input type="text" value={form.reminders} onChange={(event) => change({ reminders: event.target.value })} />
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

/** The exam settings the form holds, or what to fix first. */
function settingsOf(form: Form): { title: string; settings: ExamSettings } | MessageKey {
  if (form.kinds.length === 0) return 'exams.setup.noKinds';
  if (!form.title.trim()) return 'exams.setup.noTitle';
  const settings = cleanSettings({
    length: Number(form.length),
    difficulty: form.difficulty,
    kinds: form.kinds,
    minutes: form.timed ? Number(form.minutes) : null,
    reminders: parseReminders(form.reminders),
  });
  return { title: form.title.trim(), settings };
}

export function ExamSetup(props: { request: ExamRequest; onMake(title: string, settings: ExamSettings): void }) {
  const { request, onMake } = props;
  const [form, setForm] = useState<Form>(() => ({
    title: t('exams.title', { source: request.title }),
    length: String(DEFAULT_SETTINGS.length),
    difficulty: 'standard',
    kinds: [...QUESTION_KINDS],
    timed: false,
    minutes: '30',
    reminders: '10, 5',
  }));
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const change = (part: Partial<Form>) => setForm((now) => ({ ...now, ...part }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const made = settingsOf(form);
    setProblem(typeof made === 'string' ? made : null);
    if (typeof made !== 'string') onMake(made.title, made.settings);
  };
  return (
    <form className={styles.form} onSubmit={submit} aria-label={t('exams.setup.label')}>
      <p className={styles.note}>
        {t('exams.setup.from', { count: request.sources.length, source: request.title })}
        {request.skipped > 0 ? ` ${t('exams.setup.skipped', { count: request.skipped })}` : ''}
      </p>
      <label className={styles.field}>
        {t('exams.setup.name')}
        <input
          type="text"
          value={form.title}
          maxLength={200}
          onChange={(event) => change({ title: event.target.value })}
        />
      </label>
      <SizeFields form={form} change={change} />
      <KindFields form={form} change={change} />
      <TimerFields form={form} change={change} />
      <p className={styles.note}>{t(examModelOn() ? 'exams.setup.engineModel' : 'exams.setup.engineRules')}</p>
      {problem ? (
        <p className={styles.problem} role="alert">
          {t(problem)}
        </p>
      ) : null}
      <div className={styles.buttons}>
        <Button type="submit" variant="primary">
          {t('exams.setup.make')}
        </Button>
      </div>
    </form>
  );
}
