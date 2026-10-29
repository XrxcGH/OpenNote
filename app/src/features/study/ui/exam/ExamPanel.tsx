// The Practice exams window (ADR 0052): settings for a paper made from the notes the command read, then the paper,
// the exam itself, and the marking. Each step is one view of this window, so the person can pop it out and work in
// it alone. Nothing leaves this computer: the questions come from the rules or from the language model on it.
import { Suspense, lazy, useState } from 'react';
import { executeCommand } from '../../../../commands/registry';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { dropAttempt, loadAttempts } from '../../exam/attempt';
import { isAnswered } from '../../exam/basics';
import type { Attempt } from '../../exam/attempt';
import { examModelOn, examRequest } from '../../exam/request';
import type { ExamRequest } from '../../exam/request';
import type { Answers, Exam, ExamSettings } from '../../exam/types';
import styles from '../study.module.css';
import own from './exam.module.css';
import { ExamSetup } from './ExamSetup';
import { savePages, savedPapers } from './savePages';
import { clockText, isPaused, timeLeft } from '../../exam/timer';
import { ExamTake } from './ExamTake';
// The marking and the question writers load when they are first needed, with the math engine they use.
const ExamResults = lazy(() => import('./ExamResults').then((loaded) => ({ default: loaded.ExamResults })));

type Stage =
  | { name: 'setup' }
  | { name: 'making' }
  | { name: 'ready'; exam: Exam }
  | { name: 'taking'; exam: Exam; attempt: Attempt | null }
  | { name: 'marking'; exam: Exam; answers: Answers; late: number | null };

/** What a kept attempt says about itself: how far along it is and the time it has left. */
function attemptState(attempt: Attempt): string {
  const answered = attempt.exam.questions.filter((one) => isAnswered(one, attempt.answers[one.id])).length;
  const parts = [t('exams.resume.progress', { answered, total: attempt.exam.questions.length })];
  if (attempt.timer) {
    const left = clockText(timeLeft(attempt.timer, Date.now()));
    parts.push(t(isPaused(attempt.timer) ? 'exams.resume.paused' : 'exams.resume.running', { time: left }));
  }
  return parts.join(' ');
}

/** The exams left part way, kept on this device, each to carry on with or to let go of. */
function Unfinished({ onResume }: { onResume(attempt: Attempt): void }) {
  const [attempts, setAttempts] = useState(() => loadAttempts());
  if (attempts.length === 0) return null;
  return (
    <section className={styles.form} aria-labelledby="exam-unfinished">
      <h3 id="exam-unfinished" className={styles.title}>
        {t('exams.resume.heading')}
      </h3>
      <ul className={own.unfinished}>
        {attempts.map((attempt) => (
          <li key={attempt.exam.id}>
            <p>
              <strong>{attempt.exam.title}</strong> {attemptState(attempt)}
            </p>
            <div className={styles.buttons}>
              <Button variant="primary" onClick={() => onResume(attempt)}>
                {t('exams.resume.carryOn', { title: attempt.exam.title })}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  dropAttempt(attempt.exam.id);
                  setAttempts(loadAttempts());
                  announce(t('exams.resume.dropped', { title: attempt.exam.title }));
                }}
              >
                {t('exams.resume.drop', { title: attempt.exam.title })}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const pick = (request: ExamRequest | null) => request;

function Empty({ onResume }: { onResume(attempt: Attempt): void }) {
  return (
    <div className={styles.form}>
      <Unfinished onResume={onResume} />
      <p>{t('exams.empty')}</p>
      <div className={styles.buttons}>
        {(
          [
            ['study.examPage', 'exams.command.page'],
            ['study.examSection', 'exams.command.section'],
            ['study.examNotebook', 'exams.command.notebook'],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} onClick={() => void executeCommand(id, undefined, 'menu')}>
            {t(label)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Ready({
  exam,
  notebookId,
  onStart,
  onBack,
}: {
  exam: Exam;
  notebookId: string | null;
  onStart(): void;
  onBack(): void;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const marks = exam.questions.reduce((sum, question) => sum + question.marks, 0);
  if (exam.questions.length === 0)
    return (
      <div className={styles.form}>
        <p role="alert">{t('exams.none')}</p>
        <div className={styles.buttons}>
          <Button onClick={onBack}>{t('exams.back')}</Button>
        </div>
      </div>
    );
  const save = async () => {
    try {
      // Only the blank paper: the answer key is saved with the results, so it is not in the notebook mid-exam.
      const { paperMarkdown } = await import('../../exam/paper');
      const count = await savePages(notebookId, [{ title: exam.title, markdown: paperMarkdown(exam) }]);
      if (count !== null) savedPapers.add(exam.id);
      const message = count === null ? t('exams.save.noNotebook') : t('exams.save.paperSaved');
      setSaved(message);
      announce(message);
    } catch {
      setSaved(t('exams.save.failed'));
    }
  };
  return (
    <div className={styles.form}>
      <h3 className={styles.title}>{exam.title}</h3>
      <p>{t('exams.paper.intro', { count: exam.questions.length, marks })}</p>
      {exam.settings.minutes !== null ? <p>{t('exams.paper.time', { minutes: exam.settings.minutes })}</p> : null}
      <p className={styles.note}>{t(exam.engine === 'model' ? 'exams.ready.byModel' : 'exams.ready.byRules')}</p>
      {exam.questions.length < exam.settings.length ? (
        <p className={styles.note}>{t('exams.ready.fewer', { count: exam.questions.length })}</p>
      ) : null}
      <p className={styles.note}>{t('exams.ready.saveNote')}</p>
      {saved ? <p role="status">{saved}</p> : null}
      <div className={styles.buttons}>
        <Button variant="primary" onClick={onStart}>
          {t('exams.ready.start')}
        </Button>
        <Button disabled={savedPapers.has(exam.id)} onClick={() => void save()}>
          {t('exams.ready.save')}
        </Button>
        <Button variant="quiet" onClick={onBack}>
          {t('exams.back')}
        </Button>
      </div>
    </div>
  );
}

export function ExamPanel() {
  const request = useStore(examRequest, pick);
  // A new request starts the window again from its settings.
  return <ExamFlow key={request?.id ?? 0} request={request} />;
}

function ExamFlow({ request }: { request: ExamRequest | null }) {
  const [stage, setStage] = useState<Stage>({ name: 'setup' });
  const [notebookId, setNotebookId] = useState(request?.notebookId ?? null);
  const resume = (attempt: Attempt) => {
    if (attempt.paperSaved) savedPapers.add(attempt.exam.id);
    setNotebookId(attempt.notebookId);
    setStage({ name: 'taking', exam: attempt.exam, attempt });
    announce(t('exams.resume.resumed', { title: attempt.exam.title }));
  };
  const [problem, setProblem] = useState<string | null>(null);

  const make = async (title: string, settings: ExamSettings) => {
    setStage({ name: 'making' });
    announce(t('exams.making'));
    let model = null;
    if (examModelOn()) {
      try {
        model = await (await import('../../../intel')).languageModel();
      } catch {
        model = null;
      }
    }
    let exam: Exam;
    try {
      const { makeExam } = await import('../../exam/make');
      exam = await makeExam(request?.sources ?? [], settings, { title, model });
    } catch {
      setStage({ name: 'setup' });
      setProblem(t('exams.makeFailed'));
      return;
    }
    setProblem(null);
    setStage({ name: 'ready', exam });
    announce(exam.questions.length === 0 ? t('exams.none') : t('exams.ready.made', { count: exam.questions.length }));
  };

  return (
    <div className={`${styles.root} ${own.root}`}>
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
      {stage.name === 'setup' && !request ? <Empty onResume={resume} /> : null}
      {stage.name === 'setup' && request ? (
        <>
          <Unfinished onResume={resume} />
          <ExamSetup request={request} onMake={(title, settings) => void make(title, settings)} />
        </>
      ) : null}
      {stage.name === 'making' ? <p role="status">{t('exams.making')}</p> : null}
      {stage.name === 'ready' ? (
        <Ready
          exam={stage.exam}
          notebookId={notebookId}
          onStart={() => setStage({ name: 'taking', exam: stage.exam, attempt: null })}
          onBack={() => setStage({ name: 'setup' })}
        />
      ) : null}
      {stage.name === 'taking' ? (
        <ExamTake
          exam={stage.exam}
          attempt={stage.attempt}
          notebookId={notebookId}
          onSubmit={(answers, late, whole) => {
            if (whole) return setStage({ name: 'marking', exam: whole, answers, late });
            setProblem(t('exams.resume.keyLost'));
            setStage({ name: 'setup' });
          }}
        />
      ) : null}
      {stage.name === 'marking' ? (
        <Suspense fallback={<p role="status">{t('exams.results.marking')}</p>}>
          <ExamResults
            exam={stage.exam}
            answers={stage.answers}
            late={stage.late}
            notebookId={notebookId}
            onAgain={() => setStage({ name: 'setup' })}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
