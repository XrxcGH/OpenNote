// Practice mode (flag doc.practice): the open page's worked problem with its solution steps hidden. Steps come one at a
// time, from the keyboard or the buttons, and what is shown resets whenever the window reads a page again, the shown
// page changes, or Start over is pressed. A step that is hidden is not in the page of the window at all, so screen
// readers do not read it early.
import { useEffect, useMemo, useRef, useState } from 'react';
import { hideLast, parseProblem, revealNext, startPractice } from '../practice';
import type { Practice, Problem } from '../practice';
import { shownMarkdown } from '../pageText';
import { shownMounted } from '../../page';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { MiniMarkdown, useMathRenderer } from './MiniMarkdown';
import docs from './docTools.module.css';

export function PracticeTool() {
  const renderer = useMathRenderer();
  // Reading the page again, or another page being shown, bumps `tick`; what is shown belongs to one tick, so a new
  // tick starts with every step hidden.
  const [tick, setTick] = useState(0);
  const [held, setHeld] = useState<{ tick: number; state: Practice } | null>(null);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => shownMounted.subscribe(() => setTick((n) => n + 1)), []);

  const problem: Problem | null = useMemo(
    () => (tick >= 0 && shownMounted.get() ? parseProblem(shownMarkdown()) : null),
    [tick],
  );
  const state: Practice =
    held && held.tick === tick ? held.state : startPractice(problem?.steps.length ?? 0);
  const setState = (next: Practice) => setHeld({ tick, state: next });

  const load = () => {
    setTick((n) => n + 1);
    announce(t('docStructure.practice.readAgain'));
  };

  const next = () => {
    const after = revealNext(state);
    if (after === state) return;
    setState(after);
    announce(
      after.answered
        ? t('docStructure.practice.shownAnswer')
        : t('docStructure.practice.shownStep', { number: after.shown, total: after.total }),
    );
  };
  const back = () => {
    const after = hideLast(state);
    if (after === state) return;
    setState(after);
    announce(t('docStructure.practice.hiddenAgain', { shown: after.shown, total: after.total }));
  };
  const reset = () => {
    if (!problem) return;
    setState(startPractice(problem.steps.length));
    announce(t('docStructure.practice.started', { total: problem.steps.length }));
    area.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowRight' || event.key === 'ArrowDown') next();
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Backspace') back();
    else if (event.key === 'Home') reset();
    else return;
    event.preventDefault();
  };

  if (!problem) {
    return (
      <div className={docs.tool}>
        <p className={docs.note} role="status">
          {t(shownMounted.get() ? 'docStructure.practice.none' : 'docStructure.practice.noPage')}
        </p>
        <div className={docs.buttons}>
          <Button variant="secondary" onClick={load}>
            {t('docStructure.practice.refresh')}
          </Button>
        </div>
      </div>
    );
  }

  const last = state.shown >= state.total;
  const nextLabel = last && problem.answer !== '' ? t('docStructure.practice.nextAnswer') : t('docStructure.practice.next');
  const finished = last && (problem.answer === '' || state.answered);

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
        {problem.answer !== '' ? (
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
        ) : null}
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
        <Button variant="primary" onClick={next} disabled={finished}>
          {nextLabel}
        </Button>
        <Button variant="secondary" onClick={back} disabled={state.shown === 0}>
          {t('docStructure.practice.previous')}
        </Button>
        <Button variant="quiet" onClick={reset}>
          {t('docStructure.practice.reset')}
        </Button>
        <Button variant="quiet" onClick={load}>
          {t('docStructure.practice.refresh')}
        </Button>
      </div>
    </div>
  );
}
