// Practice mode (flag doc.practice): the open page's worked problem with its solution steps hidden. Steps come one at a
// time, from the keyboard or the buttons, and what is shown resets whenever the window reads a page again, the shown
// page changes, or Start over is pressed. A step that is hidden is not in the page of the window at all, so screen
// readers do not read it early.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MathRenderer } from '../../../editor/host';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { shownMounted } from '../../page';
import { shownMarkdown } from '../pageText';
import { hideLast, parseProblem, revealNext, startPractice } from '../practice';
import type { Practice, Problem } from '../practice';
import { MiniMarkdown, useMathRenderer } from './MiniMarkdown';
import docs from './docTools.module.css';

/**
 * The shown page's problem. Reading the page again, or another page being shown, bumps `tick`; what is shown belongs
 * to one tick, so a new tick starts with every step hidden.
 */
function useProblem(): { problem: Problem | null; tick: number; readAgain(): void } {
  const [tick, setTick] = useState(0);
  const [text, setText] = useState<{ tick: number; markdown: string | null } | null>(null);
  useEffect(() => shownMounted.subscribe(() => setTick((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    void (shownMounted.get() ? shownMarkdown() : Promise.resolve(null)).then(
      (markdown) => live && setText({ tick, markdown }),
    );
    return () => {
      live = false;
    };
  }, [tick]);
  const markdown = text?.tick === tick ? text.markdown : null;
  const problem = useMemo(() => (markdown === null ? null : parseProblem(markdown)), [markdown]);
  return {
    problem,
    tick,
    readAgain: () => {
      setTick((n) => n + 1);
      announce(t('docStructure.practice.readAgain'));
    },
  };
}

/** How much of the problem is shown, with the moves that change it. Each says what happened. */
function usePractice(problem: Problem | null, tick: number) {
  const [held, setHeld] = useState<{ tick: number; state: Practice } | null>(null);
  const state = held && held.tick === tick ? held.state : startPractice(problem?.steps.length ?? 0);
  const move = (after: Practice, message: string) => {
    setHeld({ tick, state: after });
    announce(message);
  };
  return {
    state,
    next() {
      const after = revealNext(state);
      if (after === state) return;
      move(
        after,
        after.answered
          ? t('docStructure.practice.shownAnswer')
          : t('docStructure.practice.shownStep', { number: after.shown, total: after.total }),
      );
    },
    back() {
      const after = hideLast(state);
      if (after === state) return;
      move(after, t('docStructure.practice.hiddenAgain', { shown: after.shown, total: after.total }));
    },
    reset() {
      if (problem)
        move(startPractice(problem.steps.length), t('docStructure.practice.started', { total: problem.steps.length }));
    },
  };
}

interface AreaProps {
  problem: Problem;
  state: Practice;
  renderer: MathRenderer | null;
}

function Steps({ problem, state, renderer }: AreaProps) {
  return (
    <ol className={docs.steps}>
      {problem.steps.map((step, i) => (
        <li key={i} className={docs.step} data-hidden={i >= state.shown ? '' : undefined}>
          {i < state.shown ? (
            <>
              <span className={docs.stepLabel}>{t('docStructure.practice.step', { number: i + 1 })}</span>
              <MiniMarkdown markdown={step} renderer={renderer} />
            </>
          ) : (
            <span className={docs.hidden}>{t('docStructure.practice.hiddenStep', { number: i + 1 })}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Answer({ problem, state, renderer }: AreaProps) {
  if (problem.answer === '') return null;
  return (
    <section className={docs.answer} aria-label={t('docStructure.practice.answer')}>
      {state.answered ? (
        <>
          <span className={docs.stepLabel}>{t('docStructure.practice.answer')}</span>
          <MiniMarkdown markdown={problem.answer} renderer={renderer} />
        </>
      ) : (
        <span className={docs.hidden}>{t('docStructure.practice.hiddenAnswer')}</span>
      )}
    </section>
  );
}

export function PracticeTool() {
  const renderer = useMathRenderer();
  const { problem, tick, readAgain } = useProblem();
  const practice = usePractice(problem, tick);
  const area = useRef<HTMLDivElement>(null);

  if (!problem) {
    return (
      <div className={docs.tool}>
        <p className={docs.note} role="status">
          {t(shownMounted.get() ? 'docStructure.practice.none' : 'docStructure.practice.noPage')}
        </p>
        <div className={docs.buttons}>
          <Button variant="secondary" onClick={readAgain}>
            {t('docStructure.practice.refresh')}
          </Button>
        </div>
      </div>
    );
  }

  const { state } = practice;
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (['ArrowRight', 'ArrowDown', ' ', 'Enter'].includes(event.key)) practice.next();
    else if (['ArrowLeft', 'ArrowUp', 'Backspace'].includes(event.key)) practice.back();
    else if (event.key === 'Home') practice.reset();
    else return;
    event.preventDefault();
  };
  const last = state.shown >= state.total;
  const finished = last && (problem.answer === '' || state.answered);
  const nextLabel = last && problem.answer !== '' ? 'docStructure.practice.nextAnswer' : 'docStructure.practice.next';

  return (
    <div className={docs.tool}>
      <div
        ref={area}
        className={docs.area}
        tabIndex={0}
        role="group"
        aria-label={t('docStructure.practice.title')}
        aria-describedby="practice-keys"
        onKeyDown={onKeyDown}
      >
        <section aria-label={t('docStructure.practice.problem')} className={docs.problem}>
          <MiniMarkdown markdown={problem.problem} renderer={renderer} />
        </section>
        <Steps problem={problem} state={state} renderer={renderer} />
        <Answer problem={problem} state={state} renderer={renderer} />
      </div>
      <p className={docs.note} id="practice-keys">
        {t('docStructure.practice.keysHint')}
      </p>
      <p className={docs.note} role="status">
        {finished
          ? t('docStructure.practice.done')
          : t('docStructure.practice.progress', { shown: state.shown, total: state.total })}
      </p>
      <div className={docs.buttons}>
        <Button variant="primary" onClick={practice.next} disabled={finished}>
          {t(nextLabel)}
        </Button>
        <Button variant="secondary" onClick={practice.back} disabled={state.shown === 0}>
          {t('docStructure.practice.previous')}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            practice.reset();
            area.current?.focus();
          }}
        >
          {t('docStructure.practice.reset')}
        </Button>
        <Button variant="quiet" onClick={readAgain}>
          {t('docStructure.practice.refresh')}
        </Button>
      </div>
    </div>
  );
}
