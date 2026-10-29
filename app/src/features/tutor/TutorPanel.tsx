// The Tutor panel (ADR 0050), docked at the right of the page. It shows what the tutor sees, which the person can
// edit. Below that come the consent card (when their own key would be used), the conversation, and the actions. The
// actions are a hint, the next hint, an explanation of a flagged step, the full solution, and a question box. Every
// control is a real button or field, so a keyboard, a pen, a finger, and a screen reader all reach it. The
// conversation is a log that a screen reader reads as it grows.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button, IconButton, TextField } from '../../ui';
import type { Plan } from './ladder';
import {
  answerConsentCard,
  askTutor,
  currentPlan,
  editContext,
  explainMistake,
  nextHint,
  setContext,
  showSolution,
  tutorState,
  type ShownTurn,
  type TutorState,
} from './session';
import styles from './tutor.module.css';

export interface TutorPanelProps {
  onClose: () => void;
  /** Takes the selected lines (or the page's math lines) into the context. */
  onUseSelection: () => void;
}

function whereText(turn: ShownTurn, host: string): string | null {
  if (!turn.where) return null;
  const where =
    turn.where === 'cloud'
      ? t('tutor.panel.where.cloud', { host })
      : t(turn.where === 'device' ? 'tutor.panel.where.device' : 'tutor.panel.where.rules');
  return turn.fellBack ? `${t('tutor.panel.fellBack')} ${where}` : where;
}

function ContextBox({ context, onUseSelection }: { context: string; onUseSelection: () => void }) {
  const id = useId();
  return (
    <div className={styles.context}>
      <label htmlFor={id} className={styles.label}>
        {t('tutor.panel.contextLabel')}
      </label>
      <textarea
        id={id}
        className={styles.textarea}
        value={context}
        rows={4}
        spellCheck={false}
        aria-describedby={`${id}-help`}
        onChange={(event) => editContext(event.target.value)}
      />
      <p id={`${id}-help`} className={styles.help}>
        {t('tutor.panel.contextHelp')}
      </p>
      <div className={styles.row}>
        <Button onClick={onUseSelection}>{t('tutor.panel.useSelection')}</Button>
        <Button variant="quiet" onClick={() => setContext('')} disabled={context === ''}>
          {t('tutor.panel.clear')}
        </Button>
      </div>
    </div>
  );
}

function ConsentCard({ consent }: { consent: NonNullable<TutorState['consent']> }) {
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), [consent]);
  return (
    <section ref={ref} tabIndex={-1} className={styles.consent} aria-labelledby={id} data-tutor-consent="">
      <h3 id={id} className={styles.subtitle}>
        {t('tutor.consent.title', { host: consent.host })}
      </h3>
      <p className={styles.help}>{t('tutor.consent.body', { host: consent.host })}</p>
      <pre className={styles.sent} tabIndex={0} aria-label={t('tutor.consent.sent')}>
        {consent.text}
      </pre>
      <div className={styles.row}>
        <Button variant="primary" onClick={() => answerConsentCard(true)}>
          {t('tutor.consent.send')}
        </Button>
        <Button onClick={() => answerConsentCard(false)}>{t('tutor.consent.keep')}</Button>
      </div>
    </section>
  );
}

function Conversation({ turns, host }: { turns: readonly ShownTurn[]; host: string }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [turns.length]);
  if (turns.length === 0) return <p className={styles.help}>{t('tutor.panel.empty')}</p>;
  return (
    <ol ref={ref} className={styles.log} role="log" aria-label={t('tutor.panel.log')}>
      {turns.map((turn, i) => {
        const where = whereText(turn, host);
        return (
          <li key={i} className={styles.turn} data-who={turn.who}>
            <span className={styles.who}>
              {turn.who === 'you' ? t('tutor.panel.you') : t('tutor.panel.tutorName')}
              {turn.label ? ` · ${turn.label}` : ''}
            </span>
            <span className={styles.text}>{turn.text}</span>
            {where && <span className={styles.where}>{where}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Actions({ plan, busy, rung }: { plan: Plan; busy: boolean; rung: number }) {
  const [question, setQuestion] = useState('');
  const send = () => {
    const text = question;
    setQuestion('');
    void askTutor(text);
  };
  return (
    <footer className={styles.footer}>
      <div className={styles.row}>
        <Button variant="primary" onClick={() => void nextHint()} disabled={busy}>
          {rung === 0 ? t('tutor.panel.hint') : t('tutor.panel.nextHint')}
        </Button>
        {plan.kind === 'mistake' && (
          <Button onClick={() => void explainMistake()} disabled={busy}>
            {t('tutor.panel.explain')}
          </Button>
        )}
        <Button variant="quiet" onClick={() => void showSolution()} disabled={busy}>
          {t('tutor.panel.solution')}
        </Button>
      </div>
      <div className={styles.ask}>
        <TextField
          label={t('tutor.panel.askLabel')}
          value={question}
          onChange={setQuestion}
          help={t('tutor.panel.askHelp')}
          onCommit={send}
        />
        <Button onClick={send} disabled={busy || question.trim() === ''}>
          {t('tutor.panel.send')}
        </Button>
      </div>
    </footer>
  );
}

export function TutorPanel({ onClose, onUseSelection }: TutorPanelProps) {
  const state = useStore(tutorState, (one) => one);
  const titleId = useId();
  const { context, seed } = state;
  const plan = useMemo(() => currentPlan({ context, seed }), [context, seed]);
  const host = state.consent?.host ?? 'api.openai.com';
  return (
    <section
      className={styles.panel}
      aria-labelledby={titleId}
      data-tutor-panel=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || state.consent) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {t('tutor.panel.title')}
        </h2>
        <IconButton label={t('tutor.panel.close')} icon={XIcon} onPress={onClose} />
      </header>
      <div className={styles.body}>
        <ContextBox context={context} onUseSelection={onUseSelection} />
        {state.consent && <ConsentCard consent={state.consent} />}
        <Conversation turns={state.turns} host={host} />
        {state.busy && (
          <p role="status" className={styles.help}>
            {t('tutor.panel.thinking')}
          </p>
        )}
        {state.offlineNote && <p className={styles.help}>{t('tutor.panel.where.offline')}</p>}
      </div>
      <Actions plan={plan} busy={state.busy} rung={state.rung} />
    </section>
  );
}
