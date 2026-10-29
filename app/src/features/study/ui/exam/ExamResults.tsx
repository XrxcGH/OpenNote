// Marking a practice exam. The app marks what it can, and the person marks the rest with the key and the marking
// guide beside their answer. Any mark the app gave can be changed, since blanks in words are matched as spelled.
// Then come the totals, the weak topics with a way back to their notes, missed questions to flashcards, and the
// results saved as a page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { commandContext } from '../../../../commands/registry';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import type { MathKit } from '../../exam/equivalence';
import { markExam, missedQuestions, selfMark, totals, weakTopics } from '../../exam/mark';
import type { WeakTopic } from '../../exam/mark';
import { clockText } from '../../exam/timer';
import { answerText, keyMarkdown, letterOf, paperMarkdown, resultsMarkdown } from '../../exam/paper';
import { sendToDeck } from '../../exam/toDeck';
import type { Answers, Exam, Question, QuestionMark } from '../../exam/types';
import styles from '../study.module.css';
import own from './exam.module.css';
import { InkAnswer } from './InkAnswer';
import { savePages, savedPapers } from './savePages';

/** The notes dialect and the calculator's units, loaded with the tools on first use. */
export async function loadKit(): Promise<MathKit> {
  const tools = await import('../../../tools');
  return { dialect: tools.NOTES, units: tools.calculatorUnits };
}

function keyText(question: Question): string {
  if (question.kind === 'choice' && question.correct !== undefined)
    return `${letterOf(question.correct)}. ${question.answer}`;
  if (question.kind === 'truefalse') return t(question.answer === 'true' ? 'exams.answer.true' : 'exams.answer.false');
  return question.answer;
}

function MarkPicker({ question, mark, onMark }: { question: Question; mark: QuestionMark; onMark(got: number): void }) {
  return (
    <fieldset className={own.fieldset}>
      <legend>{t('exams.results.yourMark')}</legend>
      <div className={own.marks}>
        {Array.from({ length: question.marks + 1 }, (_, got) => (
          <label key={got} className={own.option}>
            <input
              type="radio"
              name={`mark-${question.id}`}
              checked={mark.status !== 'unmarked' && mark.got === got}
              onChange={() => onMark(got)}
            />
            {t('exams.results.got', { got, of: question.marks })}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Row(props: {
  question: Question;
  number: number;
  answers: Answers;
  mark: QuestionMark;
  /** The mark the app gave, kept when the person changes it. */
  byApp: QuestionMark | undefined;
  onMark(got: number): void;
}) {
  const { question, number, answers, mark, byApp, onMark } = props;
  const answer = answers[question.id];
  return (
    <li className={own.question} data-status={mark.status}>
      <div className={styles.bar}>
        <h4 className={styles.title}>{t('exams.take.questionNumber', { number })}</h4>
        <span>
          {mark.status === 'unmarked'
            ? t('exams.results.toMark')
            : t('exams.results.got', { got: mark.got, of: mark.of })}
        </span>
      </div>
      <p className={own.prompt}>{question.prompt}</p>
      <dl className={own.compare}>
        <dt>{t('exams.results.yourAnswer')}</dt>
        <dd>{answerText(question, answer)}</dd>
        <dt>{t('exams.results.key')}</dt>
        <dd>{keyText(question)}</dd>
      </dl>
      {(answer?.ink ?? []).length > 0 ? (
        <InkAnswer label={t('exams.take.questionNumber', { number })} strokes={answer?.ink ?? []} />
      ) : null}
      {question.guide.length > 0 ? (
        <>
          <p className={styles.note}>{t('exams.key.guide')}</p>
          <ul className={own.guide}>
            {question.guide.map((point, at) => (
              <li key={at}>{point}</li>
            ))}
          </ul>
        </>
      ) : null}
      <MarkArea question={question} mark={mark} byApp={byApp} onMark={onMark} />
    </li>
  );
}

const NOTES = {
  unit: 'exams.results.noteUnit',
  close: 'exams.results.noteClose',
  blank: 'exams.results.noteBlank',
  unreadable: 'exams.results.noteUnreadable',
} as const;

/** The app's mark with a way to change it, or the marks to choose from, with the app's mark once it was changed. */
function MarkArea(props: {
  question: Question;
  mark: QuestionMark;
  byApp: QuestionMark | undefined;
  onMark(got: number): void;
}) {
  const { question, mark, byApp, onMark } = props;
  const [changing, setChanging] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The button that opened the picker is gone, so the focus goes to the mark it starts on.
    if (changing) picker.current?.querySelector<HTMLInputElement>('input:checked, input')?.focus();
  }, [changing]);
  if (mark.auto && !changing)
    return (
      <div className={styles.row}>
        <p className={`${styles.note} ${styles.grow}`}>
          {t('exams.results.byApp')}
          {mark.note ? ` ${t(NOTES[mark.note])}` : ''}
        </p>
        <Button variant="quiet" onClick={() => setChanging(true)}>
          {t('exams.results.change')}
        </Button>
      </div>
    );
  return (
    <div ref={picker}>
      <MarkPicker question={question} mark={mark} onMark={onMark} />
      {byApp?.auto && !mark.auto ? (
        <p className={styles.note}>{t('exams.results.changed', { got: byApp.got, of: byApp.of })}</p>
      ) : null}
    </div>
  );
}

/** The topics with less than 60 percent of their marks, each with a button that opens its page. */
function WeakList(props: { weak: readonly WeakTopic[]; waiting: boolean; onOpen(pageId: string): void }) {
  const { weak, waiting, onOpen } = props;
  return (
    <section aria-labelledby="exam-weak">
      <h3 id="exam-weak" className={styles.title}>
        {t('exams.results.weakTitle')}
      </h3>
      {weak.length === 0 ? (
        <p className={styles.note}>{t(waiting ? 'exams.results.weakWait' : 'exams.results.weakNone')}</p>
      ) : (
        <ul className={styles.list}>
          {weak.map((topic) => (
            <li key={`${topic.pageId}-${topic.topic}`} className={styles.row}>
              <span className={styles.grow}>
                {t('exams.results.weakLine', { topic: topic.topic, got: topic.got, of: topic.of })}
              </span>
              <Button variant="quiet" onClick={() => onOpen(topic.pageId)}>
                {t('exams.results.open', { title: topic.title })}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The marks the app can give, worked out once the math engine has loaded. */
function useMarks(exam: Exam, answers: Answers) {
  const [marks, setMarks] = useState<Record<string, QuestionMark> | null>(null);
  const [byApp, setByApp] = useState<Record<string, QuestionMark>>({});
  useEffect(() => {
    let live = true;
    void loadKit().then((kit) => {
      if (!live) return;
      const marked = markExam(exam, answers, kit);
      setMarks(marked);
      setByApp(marked);
      const total = totals(exam, marked);
      announce(t('exams.results.markedSummary', { got: total.got, of: total.of, count: total.unmarked }));
    });
    return () => {
      live = false;
    };
  }, [exam, answers]);
  return [marks, setMarks, byApp] as const;
}

/** Saves the results page with the answer key, and the paper first when it is not saved yet. Returns what to tell. */
async function saveResults(
  exam: Exam,
  answers: Answers,
  marks: Record<string, QuestionMark>,
  late: number | null,
  notebookId: string | null,
) {
  const paper = savedPapers.has(exam.id) ? [] : [{ title: exam.title, markdown: paperMarkdown(exam) }];
  const count = await savePages(notebookId, [
    ...paper,
    { title: t('exams.key.title', { title: exam.title }), markdown: keyMarkdown(exam) },
    { title: t('exams.results.title', { title: exam.title }), markdown: resultsMarkdown(exam, answers, marks, late) },
  ]);
  if (count === null) return { saved: false, text: t('exams.save.noNotebook') };
  savedPapers.add(exam.id);
  return { saved: true, text: t('exams.save.resultsSaved') };
}

export function ExamResults(props: {
  exam: Exam;
  answers: Answers;
  /** How long after the time ran out the paper was handed in, or null when in time or untimed. */
  late?: number | null;
  notebookId: string | null;
  onAgain(): void;
}) {
  const { exam, answers, late = null, notebookId, onAgain } = props;
  const [marks, setMarks, byApp] = useMarks(exam, answers);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const total = useMemo(() => (marks ? totals(exam, marks) : null), [exam, marks]);
  const weak = useMemo(() => (marks ? weakTopics(exam, marks) : []), [exam, marks]);
  if (!marks || !total) return <p role="status">{t('exams.results.marking')}</p>;
  const tell = (text: string) => {
    setMessage(text);
    announce(text);
  };
  const toCards = () => {
    const missed = missedQuestions(exam, marks);
    if (missed.length === 0) return tell(t('exams.results.noneMissed'));
    const { deck, added } = sendToDeck(exam, missed);
    tell(t('exams.results.sent', { count: added, deck: deck.name }));
  };
  const save = () =>
    saveResults(exam, answers, marks, late, notebookId).then(
      (done) => {
        setSaved(done.saved);
        tell(done.text);
      },
      () => tell(t('exams.save.failed')),
    );
  const open = async (pageId: string) => {
    const { openPage } = await import('../../../search');
    if (!(await openPage(commandContext('palette').notes, pageId))) tell(t('exams.results.pageGone'));
  };
  return (
    <div className={styles.form}>
      <h3 className={styles.title}>
        {t('exams.results.score', { got: total.got, of: total.of, percent: total.percent })}
      </h3>
      {late !== null ? <p className={styles.note}>{t('exams.results.late', { time: clockText(late) })}</p> : null}
      {total.unmarked > 0 ? (
        <p className={styles.note}>{t('exams.results.unmarked', { count: total.unmarked })}</p>
      ) : null}
      <ol className={own.results}>
        {exam.questions.map((question, at) => (
          <Row
            key={question.id}
            question={question}
            number={at + 1}
            answers={answers}
            mark={marks[question.id] ?? selfMark(question, 0)}
            byApp={byApp[question.id]}
            onMark={(got) => setMarks((now) => ({ ...now, [question.id]: selfMark(question, got) }))}
          />
        ))}
      </ol>
      <WeakList weak={weak} waiting={total.unmarked > 0} onOpen={(pageId) => void open(pageId)} />
      {message ? <p role="status">{message}</p> : null}
      <div className={styles.buttons}>
        <Button variant="primary" onClick={toCards}>
          {t('exams.results.toCards')}
        </Button>
        <Button disabled={saved} onClick={() => void save()}>
          {t('exams.results.save')}
        </Button>
        <Button variant="quiet" onClick={onAgain}>
          {t('exams.results.again')}
        </Button>
      </div>
    </div>
  );
}
