// First-run setup (ARCHITECTURE.md section 17). The steps come from the setupSteps registry, and each step is a
// lazy chunk that loads when it shows. Each step is a form whose accessible name joins its title and its
// progress. On every step change, focus moves to the step's first control and a polite announcement gives the
// step. Back never loses what was entered, because the draft lives in state.json.

import { Suspense, createElement, lazy, useEffect, useId, useRef, useState } from 'react';
import type { ComponentType, FormEvent, LazyExoticComponent, RefObject } from 'react';
import { navigate, useLocation } from '../../app/location';
import { setupSteps, useRegistry } from '../../registries';
import type { SetupDraft, SetupStepDef, SetupStepProps } from '../../registries';
import { DEFAULT_LOCATION } from '../../state/session';
import { shallowEqual, useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button, announce, showToast } from '../../ui';
import { finishSetup } from './finish';
import { saveProgress, setupStore, startRun, updateDraft } from './runtime';
import styles from './SetupView.module.css';

const flowOf = (state: ReturnType<typeof setupStore.get>) => state.flow;
const draftOf = (state: ReturnType<typeof setupStore.get>) => state.draft;

type StepComponent = LazyExoticComponent<ComponentType<SetupStepProps>>;

const lazies = new Map<string, StepComponent>();

function componentFor(step: SetupStepDef): StepComponent {
  let component = lazies.get(step.id);
  if (!component) {
    component = lazy(step.load);
    lazies.set(step.id, component);
  }
  return component;
}

/** The first control a person can reach in a step. The checked card of a radio group is the one in the tab order. */
const FIRST_CONTROL =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([readonly]), select, textarea, a[href]';

/** Moves focus to the step's first control once it exists (a step may load its choices first), and only once. */
function FocusFirst({ content, draft }: { content: RefObject<HTMLElement | null>; draft: SetupDraft }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const first = content.current?.querySelector<HTMLElement>(FIRST_CONTROL);
    const target = first ?? content.current?.closest('form')?.querySelector<HTMLElement>('button[type="submit"]');
    target?.focus();
    // A step that loads its choices first has no control yet, so it tries again on its next change.
    done.current = Boolean(first);
  }, [content, draft]);
  return null;
}

/** The run's steps. With none started (a saved location, or a development link), it starts one. */
function useSteps(): SetupStepDef[] {
  const flow = useStore(setupStore, flowOf, shallowEqual);
  const registered = useRegistry(setupSteps);
  useEffect(() => {
    if (flow.length > 0) return;
    if (startRun().length === 0) navigate(DEFAULT_LOCATION, { replace: true });
  }, [flow.length]);
  return flow.flatMap((id) => registered.find((step) => step.id === id) ?? []);
}

/** Saves where the run is, and announces a change of step, but not the first step shown. */
function useProgress(step: SetupStepDef | undefined, index: number, count: number, draft: SetupDraft): void {
  const shown = useRef<string | null>(null);
  const id = step?.id;
  useEffect(() => {
    if (!step) return;
    if (shown.current !== null && shown.current !== step.id) {
      announce(t('setup.announceStep', { step: index + 1, count, title: t(step.title) }));
    }
    shown.current = step.id;
    // Only a change of step announces; index and count follow from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (id) saveProgress(id, draft);
  }, [id, draft]);
}

function continueLabel(step: SetupStepDef, isLast: boolean): string {
  if (isLast) return t('setup.actions.finish');
  return t(step.id === 'welcome' ? 'setup.actions.getStarted' : 'setup.actions.continue');
}

const goTo = (step: SetupStepDef) => navigate({ view: 'setup', step: step.id }, { replace: true });

interface FormProps {
  steps: readonly SetupStepDef[];
  index: number;
  draft: SetupDraft;
}

/** Submitting goes to the next step, or finishes on the last one. A step that can't continue ignores it. */
function useSubmit({ steps, index, draft }: FormProps, blocked: boolean, setBusy: (busy: boolean) => void) {
  return (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    if (index < steps.length - 1) return goTo(steps[index + 1]);
    setBusy(true);
    finishSetup(steps, draft)
      .catch(() => showToast({ message: t('setup.errors.finish'), tone: 'danger' }))
      .finally(() => setBusy(false));
  };
}

function StepForm(props: FormProps) {
  const { steps, index, draft } = props;
  const step = steps[index];
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const ids = { title: useId(), progress: useId() };
  const blocked = busy || step.canContinue?.(draft) === false;
  const onSubmit = useSubmit(props, blocked, setBusy);
  const stepProps: SetupStepProps = {
    draft,
    setDraft: updateDraft,
    stepIndex: index,
    stepCount: steps.length,
    titleId: ids.title,
    progressId: ids.progress,
  };
  return (
    <main className={styles.screen}>
      <form
        className={styles.card}
        aria-labelledby={`${ids.title} ${ids.progress}`}
        aria-busy={busy || undefined}
        noValidate
        onSubmit={onSubmit}
      >
        <div className={styles.content} ref={content}>
          <Suspense fallback={null}>
            {createElement(componentFor(step), stepProps)}
            <FocusFirst key={step.id} content={content} draft={draft} />
          </Suspense>
        </div>
        <footer className={styles.footer}>
          {index > 0 && (
            <Button variant="quiet" onClick={() => goTo(steps[index - 1])}>
              {t('setup.actions.back')}
            </Button>
          )}
          <Button variant="primary" type="submit" aria-disabled={blocked || undefined}>
            {continueLabel(step, index === steps.length - 1)}
          </Button>
        </footer>
      </form>
    </main>
  );
}

export function SetupView() {
  const steps = useSteps();
  const location = useLocation();
  const draft = useStore(setupStore, draftOf);
  const requested = location.view === 'setup' ? location.step : null;
  const found = steps.findIndex((candidate) => candidate.id === requested);
  const index = Math.max(0, found);
  useProgress(steps[index] as SetupStepDef | undefined, index, steps.length, draft);
  if (steps.length === 0) return null;
  return <StepForm key={steps[index].id} steps={steps} index={index} draft={draft} />;
}
