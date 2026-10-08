// Send feedback (docs/design/SCREENS.md, Send feedback). The form, then the whole file on screen, then a save.
// The file is built on this computer, shown in full, and saved only with the digest of the text that was shown.
// OpenNote does not send it. The person attaches it to their report or email.

import { useEffect, useId, useReducer, useState } from 'react';
import { t } from '../../strings/t';
import { Button, Dialog, Switch, announce } from '../../ui';
import { DiagnosticsError } from './client';
import styles from './Diagnostics.module.css';
import { uiFacts } from './facts';
import { canSave, openFeedback, reduceFeedback, removedLine, saveRequest, sectionRows } from './feedback';
import type { FeedbackEvent, FeedbackState } from './feedback';
import { diagnostics } from './runtime';

type Note = 'failed' | 'canceled' | 'buildFailed' | null;
type Dispatch = (event: FeedbackEvent) => void;
type Reviewing = Extract<FeedbackState, { review: unknown }>;

/** The sentence under the form or the file: what went wrong or did not happen, or that the file is saved. */
function messageFor(state: FeedbackState, note: Note): string | null {
  if (state.step === 'saved') return t('diagnostics.feedback.saved', { name: state.name });
  if (note === 'canceled') return t('diagnostics.feedback.canceled');
  if (note === 'buildFailed') return t('diagnostics.feedback.buildFailed');
  return state.step === 'failed' ? t('diagnostics.feedback.failed') : null;
}

/** Builds the file when the form asks for it, and saves it when the review asks for that. */
function useFeedbackSteps(state: FeedbackState, dispatch: Dispatch, setNote: (note: Note) => void): void {
  useEffect(() => {
    if (state.step !== 'building') return;
    let current = true;
    diagnostics()
      .buildFeedback(state.options, uiFacts())
      .then(({ bundle, review }) => current && dispatch({ type: 'built', bundle, review }))
      .catch(() => {
        if (!current) return;
        setNote('buildFailed');
        dispatch({ type: 'buildFailed' });
      });
    return () => {
      current = false;
    };
  }, [state, dispatch, setNote]);

  useEffect(() => {
    const request = saveRequest(state);
    if (!request) return;
    let current = true;
    diagnostics()
      .saveFeedback(request.digest)
      .then(({ name }) => {
        announce(t('diagnostics.feedback.saved', { name }));
        if (current) dispatch({ type: 'saved', name });
      })
      .catch((error: unknown) => {
        if (!current) return;
        const canceled = error instanceof DiagnosticsError && error.code === 'canceled';
        setNote(canceled ? 'canceled' : 'failed');
        dispatch({ type: canceled ? 'saveCanceled' : 'saveFailed' });
      });
    return () => {
      current = false;
    };
  }, [state, dispatch, setNote]);
}

function Form({
  state,
  dispatch,
}: {
  state: Extract<FeedbackState, { step: 'edit' | 'building' }>;
  dispatch: Dispatch;
}) {
  const [reports, setReports] = useState(0);
  const areaId = useId();
  const busy = state.step === 'building';
  useEffect(() => {
    let current = true;
    void diagnostics()
      .listReports()
      .then((list) => current && setReports(list.length))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return (
    <>
      <p>{t('diagnostics.feedback.intro')}</p>
      <div>
        <label className={styles.label} htmlFor={areaId}>
          {t('diagnostics.feedback.descriptionLabel')}
        </label>
        <textarea
          id={areaId}
          className={styles.area}
          value={state.options.description}
          maxLength={2000}
          readOnly={busy}
          aria-describedby={`${areaId}-help`}
          onChange={(event) => dispatch({ type: 'change', options: { description: event.target.value } })}
        />
        <p id={`${areaId}-help`} className={styles.help}>
          {t('diagnostics.feedback.descriptionHelp')}
        </p>
      </div>
      <Switch
        label={t('diagnostics.feedback.includeLogs')}
        checked={state.options.includeLogs}
        disabled={busy ? 'aria' : false}
        onChange={(includeLogs) => dispatch({ type: 'change', options: { includeLogs } })}
      />
      <Switch
        label={t('diagnostics.feedback.includeCrashReports')}
        checked={state.options.includeCrashReports}
        disabled={busy ? 'aria' : false}
        onChange={(includeCrashReports) => dispatch({ type: 'change', options: { includeCrashReports } })}
      />
      <p className={styles.help}>
        {reports === 0
          ? t('diagnostics.feedback.crashReportsNone')
          : t('diagnostics.feedback.crashReportsCount', { count: reports })}
      </p>
    </>
  );
}

function Review({ state }: { state: Reviewing }) {
  const id = useId();
  return (
    <>
      <p>{t('diagnostics.feedback.reviewIntro')}</p>
      <div className={styles.split}>
        <pre className={styles.text} role="region" tabIndex={0} aria-label={t('diagnostics.feedback.fileLabel')}>
          {state.review.text}
        </pre>
        <div>
          <h3 id={`${id}-parts`}>{t('diagnostics.feedback.partsLabel')}</h3>
          <ul className={styles.parts} aria-labelledby={`${id}-parts`}>
            {sectionRows(state.bundle).map((row) => (
              <li key={row.id}>
                <span>{row.title}</span>
                <span className={styles.help}>{row.count}</span>
              </li>
            ))}
          </ul>
          <p className={styles.help}>{removedLine(state.bundle.redactions)}</p>
        </div>
      </div>
    </>
  );
}

interface ActionProps {
  state: FeedbackState;
  dispatch: Dispatch;
  close(): void;
  clearNote(): void;
}

function Actions({ state, dispatch, close, clearNote }: ActionProps) {
  const busy = state.step === 'building' || state.step === 'saving';
  const idle = (run: () => void) => () => {
    if (busy) return;
    run();
  };
  if (state.step === 'saved') {
    return (
      <Button variant="primary" onClick={close}>
        {t('diagnostics.feedback.done')}
      </Button>
    );
  }
  const form = state.step === 'edit' || state.step === 'building';
  const move = (event: FeedbackEvent) => () => {
    clearNote();
    dispatch(event);
  };
  return (
    <>
      <Button aria-disabled={busy ? true : undefined} onClick={idle(close)}>
        {t('diagnostics.feedback.close')}
      </Button>
      {!form && (
        <>
          <Button aria-disabled={busy ? true : undefined} onClick={idle(move({ type: 'back' }))}>
            {t('diagnostics.feedback.back')}
          </Button>
          <Button
            variant="primary"
            aria-disabled={canSave(state) ? undefined : true}
            onClick={() => canSave(state) && move({ type: 'save' })()}
          >
            {t('diagnostics.feedback.save')}
          </Button>
        </>
      )}
      {form && (
        <Button variant="primary" aria-disabled={busy ? true : undefined} onClick={idle(move({ type: 'review' }))}>
          {t('diagnostics.feedback.review')}
        </Button>
      )}
    </>
  );
}

export function FeedbackDialog({ onClose }: { onClose(): void }) {
  const [state, dispatch] = useReducer(reduceFeedback, undefined, () => openFeedback());
  const [note, setNote] = useState<Note>(null);
  useFeedbackSteps(state, dispatch, setNote);
  const close = () => {
    if (reduceFeedback(state, { type: 'close' }).step === 'closed') onClose();
  };
  const message = messageFor(state, note);
  const reviewing = 'review' in state;
  const form = state.step === 'edit' || state.step === 'building';
  return (
    <Dialog
      title={t(reviewing ? 'diagnostics.feedback.reviewTitle' : 'diagnostics.feedback.title')}
      size="large"
      onDismiss={close}
    >
      <div className={styles.body}>
        {form && <Form state={state} dispatch={dispatch} />}
        {reviewing && <Review state={state} />}
        {state.step === 'building' && <p role="status">{t('diagnostics.feedback.building')}</p>}
        {state.step === 'saving' && <p role="status">{t('diagnostics.feedback.saving')}</p>}
        {message && (
          <p role="status" className={state.step === 'failed' || note === 'buildFailed' ? styles.error : undefined}>
            {message}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Actions state={state} dispatch={dispatch} close={close} clearNote={() => setNote(null)} />
      </div>
    </Dialog>
  );
}
