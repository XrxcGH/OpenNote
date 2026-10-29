// Taking a practice exam, one question at a time or all of them. Each kind has its own answer field: choices, true
// or false, blanks, typed math, working, and an area to write in. Any question can be flagged for review. The
// optional countdown can pause and gives reminders at set minutes left. When time is up, the window says so, and
// the person submits.
import { useEffect, useRef, useState } from 'react';
import { isEnabled } from '../../../../app/flags';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { Button, announce, confirm } from '../../../../ui';
import { splitBlanks } from '../../deck/cloze';
import { blanksOfQuestion, isAnswered, keyHasUnit, letterOf } from '../../exam/basics';
import {
  clockText,
  dueReminders,
  isOver,
  isPaused,
  lateBy,
  pauseTimer,
  resumeTimer,
  startTimer,
  timeLeft,
} from '../../exam/timer';
import type { ExamTimer } from '../../exam/timer';
import { dropAttempt, joinKey, saveAttempt } from '../../exam/attempt';
import type { Attempt } from '../../exam/attempt';
import type { Answer, Answers, Exam, InkPoint, Question } from '../../exam/types';
import styles from '../study.module.css';
import own from './exam.module.css';
import { InkAnswer } from './InkAnswer';
import { savedPapers } from './savePages';

const KIND_HINT: Record<Question['kind'], MessageKey> = {
  short: 'exams.take.hintShort',
  choice: 'exams.take.hintChoice',
  fill: 'exams.take.hintFill',
  worked: 'exams.take.hintWorked',
  truefalse: 'exams.take.hintTrueFalse',
};

/** Reads handwriting as math with the on-device reader, and writes it as the engine's text. */
async function readInk(strokes: readonly InkPoint[][]): Promise<string | null> {
  const math = await import('../../../math');
  const pen = math.mathRenderer.pen;
  if (!pen) return null;
  const latex = await pen.recognize(strokes.map((stroke) => stroke.map(([x, y]) => [x, y] as [number, number])));
  if (!latex) return null;
  try {
    return math.latexToText(latex);
  } catch {
    return latex;
  }
}

interface FieldProps {
  question: Question;
  number: number;
  answer: Answer;
  onChange(answer: Answer): void;
}

function Prompt({ question }: { question: Question }) {
  if (question.kind !== 'fill') return <span>{question.prompt}</span>;
  const parts = splitBlanks(question.prompt);
  // The number of each blank: how many blanks come before it, plus one.
  const numbers = parts.map((_, at) => parts.slice(0, at + 1).filter((part) => part.blank).length);
  return (
    <span>
      {parts.map((part, at) =>
        part.blank ? (
          <span key={at} className={styles.blank}>
            {t('exams.take.blankMark', { number: numbers[at] ?? 1 })}
          </span>
        ) : (
          <span key={at}>{part.text}</span>
        ),
      )}
    </span>
  );
}

function OptionField({ question, number, answer, onChange }: FieldProps) {
  const options =
    question.kind === 'choice'
      ? (question.choices ?? []).map((choice, at) => `${letterOf(at)}. ${choice}`)
      : [t('exams.answer.true'), t('exams.answer.false')];
  return (
    <fieldset className={own.fieldset}>
      <legend className={own.hidden}>{t('exams.take.optionsFor', { number })}</legend>
      {options.map((option, at) => (
        <label key={option} className={own.option}>
          <input
            type="radio"
            name={`exam-${question.id}`}
            checked={answer.picked === at}
            onChange={() => onChange({ ...answer, picked: at })}
          />
          {option}
        </label>
      ))}
    </fieldset>
  );
}

function BlankFields({ question, answer, onChange }: FieldProps) {
  const blanks = blanksOfQuestion(question);
  return (
    <>
      {blanks.map((_, at) => (
        <label key={at} className={styles.field}>
          {t('exams.take.blank', { number: at + 1 })}
          <input
            type="text"
            autoComplete="off"
            value={answer.blanks?.[at] ?? ''}
            onChange={(event) => {
              const next = blanks.map((__, index) => answer.blanks?.[index] ?? '');
              next[at] = event.target.value;
              onChange({ ...answer, blanks: next });
            }}
          />
        </label>
      ))}
    </>
  );
}

function TypedFields({ question, answer, onChange }: FieldProps) {
  const short = question.math === true || question.kind === 'worked';
  const typed = (text: string) => onChange({ ...answer, text });
  return (
    <>
      {question.kind === 'worked' ? (
        <label className={styles.field}>
          {t('exams.take.working')}
          <textarea
            value={answer.working ?? ''}
            maxLength={8000}
            onChange={(event) => onChange({ ...answer, working: event.target.value })}
          />
        </label>
      ) : null}
      <label className={styles.field}>
        {t(question.kind === 'worked' ? 'exams.take.finalAnswer' : 'exams.take.yourAnswer')}
        {short ? (
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={240}
            value={answer.text ?? ''}
            onChange={(event) => typed(event.target.value)}
          />
        ) : (
          <textarea value={answer.text ?? ''} maxLength={4000} onChange={(event) => typed(event.target.value)} />
        )}
      </label>
      {question.math ? <p className={styles.note}>{t('exams.take.mathHint')}</p> : null}
      {question.math && (question.unit ?? keyHasUnit(question.answer)) ? (
        <p className={styles.note}>{t('exams.take.unitHint')}</p>
      ) : null}
    </>
  );
}

/** The area to write the answer in, shown on request, with a way to read handwritten math. */
function WritingArea({ question, number, answer, onChange }: FieldProps) {
  const [writing, setWriting] = useState((answer.ink ?? []).length > 0);
  const [reading, setReading] = useState<string | null>(null);
  const read = async () => {
    setReading(t('exams.ink.reading'));
    try {
      const text = await readInk(answer.ink ?? []);
      if (text) onChange({ ...answer, text });
      setReading(text ? t('exams.ink.readDone', { text }) : t('exams.ink.readNothing'));
    } catch {
      setReading(t('exams.ink.readFailed'));
    }
  };
  const canRead = question.math === true && isEnabled('intel.mathInk');
  return (
    <>
      <div className={styles.buttons}>
        <Button variant="quiet" aria-expanded={writing} onClick={() => setWriting((now) => !now)}>
          {t(writing ? 'exams.ink.hide' : 'exams.ink.show')}
        </Button>
      </div>
      {writing ? (
        <InkAnswer
          label={t('exams.take.questionNumber', { number })}
          strokes={answer.ink ?? []}
          onChange={(ink) => onChange({ ...answer, ink })}
          {...(canRead ? { onRead: () => void read() } : {})}
        />
      ) : null}
      {reading ? <p role="status">{reading}</p> : null}
    </>
  );
}

function AnswerField(props: FieldProps) {
  const { kind } = props.question;
  if (kind === 'choice' || kind === 'truefalse') return <OptionField {...props} />;
  if (kind === 'fill') return <BlankFields {...props} />;
  return (
    <>
      <TypedFields {...props} />
      <WritingArea {...props} />
    </>
  );
}

function QuestionCard(props: FieldProps & { total: number }) {
  const { question, number, total, answer, onChange } = props;
  return (
    <section className={own.question} aria-labelledby={`exam-${question.id}-title`}>
      <div className={styles.bar}>
        <h3 id={`exam-${question.id}-title`} className={styles.title}>
          {t('exams.take.counter', { number, total })}
        </h3>
        <span className={styles.note}>{t('exams.paper.marks', { count: question.marks })}</span>
      </div>
      <p className={own.prompt}>
        <Prompt question={question} />
      </p>
      <p className={styles.note}>{t(KIND_HINT[question.kind])}</p>
      <AnswerField question={question} number={number} answer={answer} onChange={onChange} />
      <div className={styles.buttons}>
        <Button
          variant="quiet"
          aria-pressed={answer.flagged === true}
          onClick={() => onChange({ ...answer, flagged: !answer.flagged })}
        >
          {t(answer.flagged ? 'exams.take.unflag' : 'exams.take.flag')}
        </Button>
      </div>
    </section>
  );
}

interface ClockProps {
  exam: Exam;
  timer: ExamTimer | null;
  setTimer(update: (current: ExamTimer | null) => ExamTimer | null): void;
}

function Clock({ exam, timer, setTimer }: ClockProps) {
  const [now, setNow] = useState(() => Date.now());
  const told = useRef(false);
  const latest = useRef(timer);
  useEffect(() => {
    latest.current = timer;
  }, [timer]);
  const running = timer !== null;
  const reminders = exam.settings.reminders;
  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => {
      const at = Date.now();
      const current = latest.current;
      setNow(at);
      if (!current) return;
      const { timer: next, due } = dueReminders(current, reminders, at);
      for (const left of due) announce(t('exams.timer.reminder', { minutes: left }));
      if (isOver(next, at) && !told.current) {
        told.current = true;
        announce(t('exams.timer.up'));
      }
      if (next !== current) setTimer(() => next);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [running, reminders, setTimer]);
  if (!timer) return null;
  const left = timeLeft(timer, now);
  const paused = isPaused(timer);
  return (
    <div className={own.clock}>
      <span role="timer" aria-live="off" className={own.time}>
        {t('exams.timer.left', { time: clockText(left) })}
      </span>
      {left === 0 ? (
        <span role="status">{t('exams.timer.up')}</span>
      ) : (
        <Button
          variant="quiet"
          aria-pressed={paused}
          onClick={() => {
            const at = Date.now();
            setTimer((current) => current && (isPaused(current) ? resumeTimer(current, at) : pauseTimer(current, at)));
            announce(t(paused ? 'exams.timer.resumed' : 'exams.timer.paused'));
          }}
        >
          {t(paused ? 'exams.timer.resume' : 'exams.timer.pause')}
        </Button>
      )}
    </div>
  );
}

interface JumpProps {
  exam: Exam;
  answers: Answers;
  at: number;
  all: boolean;
  onJump(index: number): void;
}

/** A button for each question that says whether it is answered and flagged, to go straight to it. */
function JumpList({ exam, answers, at, all, onJump }: JumpProps) {
  return (
    <nav aria-label={t('exams.take.navigation')}>
      <ol className={own.jump}>
        {exam.questions.map((one, index) => {
          const answer = answers[one.id];
          const answered = isAnswered(one, answer);
          const state = [
            t(answered ? 'exams.take.stateAnswered' : 'exams.take.stateOpen'),
            ...(answer?.flagged ? [t('exams.take.stateFlagged')] : []),
          ].join(', ');
          return (
            <li key={one.id}>
              <button
                type="button"
                className={own.jumpButton}
                aria-current={!all && index === at ? 'step' : undefined}
                aria-label={t('exams.take.jump', { number: index + 1, state })}
                data-answered={answered ? '' : undefined}
                data-flagged={answer?.flagged ? '' : undefined}
                onClick={() => onJump(index)}
              >
                {index + 1}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Asks first when questions are unanswered or flagged. Resolves true when the person submits. */
async function sureToSubmit(exam: Exam, answers: Answers): Promise<boolean> {
  const open = exam.questions.filter((one) => !isAnswered(one, answers[one.id])).length;
  const flagged = exam.questions.filter((one) => answers[one.id]?.flagged).length;
  if (open === 0 && flagged === 0) return true;
  return confirm({
    title: t('exams.take.submitTitle'),
    body: t('exams.take.submitBody', { open, flagged }),
    confirmLabel: t('exams.take.submit'),
    cancelLabel: t('exams.take.keepGoing'),
  });
}

/** How long the window waits after a change before keeping the attempt, so typing is not written on every key. */
const KEEP_AFTER_MS = 400;

export interface ExamTakeProps {
  exam: Exam;
  /** The attempt to carry on with, or null to start the exam afresh. */
  attempt: Attempt | null;
  notebookId: string | null;
  /** The answers, and how long after the time ran out they were handed in (null when in time or untimed). */
  /** `exam` is the exam with its key, or null when a resumed paper's key could not be read back. */
  onSubmit(answers: Answers, late: number | null, exam: Exam | null): void;
}

export function ExamTake({ exam, attempt, notebookId, onSubmit }: ExamTakeProps) {
  const [answers, setAnswers] = useState<Answers>(() => attempt?.answers ?? {});
  const [at, setAt] = useState(() => Math.min(Math.max(0, attempt?.at ?? 0), Math.max(0, exam.questions.length - 1)));
  const [all, setAll] = useState(false);
  const [timer, setTimer] = useState<ExamTimer | null>(() =>
    attempt ? attempt.timer : exam.settings.minutes === null ? null : startTimer(exam.settings.minutes, Date.now()),
  );
  // The attempt is kept a moment after each change, and at once when the window closes or this view goes away,
  // until the exam is submitted.
  const done = useRef(false);
  const pending = useRef<number | null>(null);
  const current = useRef<Attempt | null>(null);
  const keep = useRef(() => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = null;
    if (!done.current && current.current) saveAttempt({ ...current.current, saved: Date.now() });
  });
  useEffect(() => {
    current.current = { exam, answers, timer, at, notebookId, paperSaved: savedPapers.has(exam.id), saved: 0 };
    if (done.current) return;
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(keep.current, KEEP_AFTER_MS);
  }, [exam, answers, timer, at, notebookId]);
  useEffect(() => {
    const now = keep.current;
    window.addEventListener('pagehide', now);
    return () => {
      window.removeEventListener('pagehide', now);
      now();
    };
  }, []);
  const submit = (given: Answers) => {
    done.current = true;
    if (pending.current !== null) window.clearTimeout(pending.current);
    // A resumed paper has no key: it is read back from where it was kept, before the attempt and its key are dropped.
    const whole = joinKey(exam);
    dropAttempt(exam.id);
    onSubmit(given, lateBy(timer, Date.now()), whole);
  };
  const total = exam.questions.length;
  const shown = all ? exam.questions : exam.questions.slice(at, at + 1);
  const set = (id: string) => (answer: Answer) => setAnswers((now) => ({ ...now, [id]: answer }));
  const jump = (index: number) => {
    setAt(index);
    const one = exam.questions[index];
    if (all && one) document.getElementById(`exam-${one.id}-title`)?.scrollIntoView({ block: 'start' });
  };
  return (
    <div className={styles.form}>
      <div className={styles.bar}>
        <Clock exam={exam} timer={timer} setTimer={setTimer} />
        <Button variant="quiet" aria-pressed={all} onClick={() => setAll((now) => !now)}>
          {t(all ? 'exams.take.oneAtATime' : 'exams.take.showAll')}
        </Button>
      </div>
      <JumpList exam={exam} answers={answers} at={at} all={all} onJump={jump} />
      {shown.map((one) => (
        <QuestionCard
          key={one.id}
          question={one}
          number={exam.questions.indexOf(one) + 1}
          total={total}
          answer={answers[one.id] ?? {}}
          onChange={set(one.id)}
        />
      ))}
      <div className={styles.buttons}>
        {!all ? (
          <>
            <Button disabled={at === 0} onClick={() => setAt((now) => Math.max(0, now - 1))}>
              {t('exams.take.previous')}
            </Button>
            <Button disabled={at >= total - 1} onClick={() => setAt((now) => Math.min(total - 1, now + 1))}>
              {t('exams.take.next')}
            </Button>
          </>
        ) : null}
        <Button
          variant="primary"
          onClick={() => void sureToSubmit(exam, answers).then((sure) => sure && submit(answers))}
        >
          {t('exams.take.submit')}
        </Button>
      </div>
    </div>
  );
}
