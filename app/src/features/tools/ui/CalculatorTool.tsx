// The calculator (Phase 10): a scientific tab with expression entry, history, a memory slot, degrees, and radians, a key
// pad for touch and pen, and unit conversion ("5 km to mi"), and a graphing tab that is the function grapher. It
// runs on the same expression engine as table formulas and the grapher, so results match. History stays on this
// device and can be cleared. "Insert into page" hands the answer, or the graph, to the page that is open.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import type { CalcSession } from '../calculator';
import {
  clearHistory,
  convertText,
  formatNumber,
  memoryClear,
  memoryStore,
  newSession,
  restoreSession,
  setAngleMode,
  submit,
} from '../calculator';
import { INSERT_EVENT } from '../flags';
import { loadStored, saveStored, watchStored } from './storage';
import styles from './tools.module.css';

const Graph = lazy(() => import('../../math').then((loaded) => ({ default: loaded.GraphView })));
const STORE = 'calculator';
const GRAPH_STORE = 'calculator.graph';
const FIRST_GRAPH = 'y = sin(x)';

/** What a tool asks the page to take: text for the caret, or a graph for a code block. */
export interface InsertDetail {
  text?: string;
  graph?: string;
  handled: boolean;
}

export function insertIntoPage(detail: Omit<InsertDetail, 'handled'>): boolean {
  const request: InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail: request }));
  return request.handled;
}

const KEYS: readonly (readonly string[])[] = [
  ['sin(', 'cos(', 'tan(', 'ln(', 'log('],
  ['7', '8', '9', '÷', '('],
  ['4', '5', '6', '×', ')'],
  ['1', '2', '3', '−', '^'],
  ['0', '.', 'π', '+', 'sqrt('],
  ['ans', 'abs(', '!', '%', 'e'],
];

interface Answer {
  text: string;
  note?: string;
}

export function CalculatorTool() {
  const [tab, setTab] = useState<'scientific' | 'graphing'>('scientific');
  return (
    <div className={styles.tool}>
      <div role="tablist" aria-label={t('smart.tools.calculator.tabs')} className={styles.tabs}>
        {(['scientific', 'graphing'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            id={`calc-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`calc-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={styles.tab}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                setTab(id === 'scientific' ? 'graphing' : 'scientific');
                event.preventDefault();
              }
            }}
          >
            {t(`smart.tools.calculator.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`calc-panel-${tab}`} aria-labelledby={`calc-tab-${tab}`}>
        {tab === 'scientific' ? <Scientific /> : <Graphing />}
      </div>
    </div>
  );
}

function Scientific() {
  const [session, setSession] = useState<CalcSession>(() => restoreSession(loadStored(STORE, null)));
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [problem, setProblem] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => watchStored(STORE, () => setSession(restoreSession(loadStored(STORE, null)))), []);

  const keep = (next: CalcSession) => {
    setSession(next);
    saveStored(STORE, next);
  };
  const run = () => {
    const source = input.trim();
    if (source === '') return;
    const converted = convertText(source);
    if (converted) {
      if (converted.ok) {
        const text = formatNumber(converted.value);
        setAnswer({ text, note: t('smart.tools.calculator.converted', { input: source, value: text }) });
        setProblem('');
      } else setProblem(t('smart.tools.calculator.convertFailed'));
      return;
    }
    const done = submit(session, source.replace(/−/g, '-'));
    if (done.result.ok) {
      keep(done.session);
      setAnswer({ text: formatNumber(done.result.value) });
      setProblem('');
      setInput('');
    } else setProblem(t(`smart.tools.calculator.errors.${done.result.error.code}`));
  };
  const type = (piece: string) => {
    const element = field.current;
    const start = element?.selectionStart ?? input.length;
    const end = element?.selectionEnd ?? input.length;
    setInput(input.slice(0, start) + piece + input.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + piece.length, start + piece.length);
    });
  };
  const copy = () => {
    if (!answer) return;
    void navigator.clipboard?.writeText(answer.text).then(
      () => announce(t('smart.tools.calculator.copied')),
      () => undefined,
    );
  };
  return (
    <>
      <div className={styles.entry}>
        <label className={styles.field}>
          <span>{t('smart.tools.calculator.expression')}</span>
          <input
            ref={field}
            className={styles.expression}
            value={input}
            placeholder={t('smart.tools.calculator.placeholder')}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby="calc-result"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) run();
            }}
          />
        </label>
        <Button variant="primary" onClick={run}>
          {t('smart.tools.calculator.calculate')}
        </Button>
      </div>
      <div id="calc-result" className={styles.result} role="status">
        {problem ? (
          <span className={styles.problem}>{problem}</span>
        ) : answer ? (
          <strong>{t('smart.tools.calculator.answer', { value: answer.text })}</strong>
        ) : null}
      </div>
      {answer ? (
        <div className={styles.buttons}>
          <Button variant="quiet" onClick={copy}>
            {t('smart.tools.calculator.copy')}
          </Button>
          <Button
            variant="quiet"
            onClick={() => insertIntoPage({ text: answer.text }) && announce(t('smart.tools.calculator.inserted'))}
          >
            {t('smart.tools.calculator.insert')}
          </Button>
        </div>
      ) : null}
      <Keypad onKey={type} />
      <MemoryBar session={session} onChange={keep} onRecall={() => type('m1')} />
      <History session={session} onUse={type} onClear={() => keep(clearHistory(session))} />
    </>
  );
}

interface PadProps {
  onKey(piece: string): void;
}

function Keypad({ onKey }: PadProps) {
  return (
    <div className={styles.keys} role="group" aria-label={t('smart.tools.calculator.keypad')}>
      {KEYS.flat().map((key) => (
        <Button key={key} variant="secondary" onClick={() => onKey(key)}>
          {key}
        </Button>
      ))}
    </div>
  );
}

interface MemoryProps {
  session: CalcSession;
  onChange(next: CalcSession): void;
  onRecall(): void;
}

/** The angle unit and the one memory slot. */
function MemoryBar({ session, onChange, onRecall }: MemoryProps) {
  const lastValue = session.history.at(-1)?.value;
  const slot = session.memory[0];
  return (
    <>
      <div className={styles.buttons}>
        <Button
          variant="quiet"
          aria-pressed={session.angle === 'deg'}
          onClick={() => onChange(setAngleMode(session, session.angle === 'deg' ? 'rad' : 'deg'))}
        >
          {t(session.angle === 'deg' ? 'smart.tools.calculator.degrees' : 'smart.tools.calculator.radians')}
        </Button>
        <Button
          variant="quiet"
          disabled={lastValue === undefined}
          onClick={() => lastValue !== undefined && onChange(memoryStore(session, 1, lastValue))}
        >
          {t('smart.tools.calculator.memoryStore')}
        </Button>
        <Button variant="quiet" disabled={slot === null} onClick={() => onRecall()}>
          {t('smart.tools.calculator.memoryRecall')}
        </Button>
        <Button variant="quiet" disabled={slot === null} onClick={() => onChange(memoryClear(session))}>
          {t('smart.tools.calculator.memoryClear')}
        </Button>
      </div>
      <p className={styles.note}>
        {slot === null
          ? t('smart.tools.calculator.memoryEmpty')
          : t('smart.tools.calculator.memoryHolds', { value: formatNumber(slot) })}
      </p>
    </>
  );
}

interface HistoryProps {
  session: CalcSession;
  onUse(expression: string): void;
  onClear(): void;
}

function History({ session, onUse, onClear }: HistoryProps) {
  return (
    <section aria-labelledby="calc-history">
      <h3 id="calc-history" className={styles.groupTitle}>
        {t('smart.tools.calculator.history')}
      </h3>
      {session.history.length === 0 ? (
        <p className={styles.empty}>{t('smart.tools.calculator.historyEmpty')}</p>
      ) : (
        <>
          <ul className={styles.items}>
            {[...session.history]
              .reverse()
              .slice(0, 30)
              .map((entry) => (
                <li key={entry.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.link}
                    aria-label={t('smart.tools.calculator.useEntry', { expression: entry.expression })}
                    onClick={() => onUse(entry.expression)}
                  >
                    {entry.expression}
                  </button>
                  <span className={styles.itemDue}>
                    {t('smart.tools.calculator.answer', { value: formatNumber(entry.value) })}
                  </span>
                </li>
              ))}
          </ul>
          <Button variant="quiet" onClick={() => onClear()}>
            {t('smart.tools.calculator.clearHistory')}
          </Button>
        </>
      )}
    </section>
  );
}

function Graphing() {
  const [source, setSource] = useState(() => loadStored<string>(GRAPH_STORE, FIRST_GRAPH));
  return (
    <Suspense fallback={null}>
      <Graph
        source={source}
        editable
        onSource={(next) => {
          setSource(next);
          saveStored(GRAPH_STORE, next);
        }}
      />
      <div className={styles.buttons}>
        <Button
          variant="quiet"
          onClick={() => insertIntoPage({ graph: source }) && announce(t('smart.tools.calculator.inserted'))}
        >
          {t('smart.tools.calculator.insert')}
        </Button>
      </div>
    </Suspense>
  );
}

export { newSession };
