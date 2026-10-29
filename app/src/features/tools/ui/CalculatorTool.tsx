// The calculator (Phase 10, with the modes of the calculator and graphing lane). Basic is a four-function keypad.
// Scientific has expression entry, history, a memory slot, degrees, radians, and unit conversion ("5 km to mi").
// Graphing 2D and Graphing 3D are the function grapher. Programmer, Statistics, and Matrix are in CalculatorModes.tsx.
// Every mode runs on the same expression engine as table formulas and the grapher, so results match. History stays
// on this device and can be cleared. "Insert into page" hands the answer, the graph, or its picture to the page.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { Button, Switch, announce } from '../../../ui';
import type { AnswerFormat, CalcSession } from '../calculator';
import {
  clearHistory,
  convertText,
  formatAnswer,
  formatNumber,
  leastSigFigs,
  restoreAnswerFormat,
  memoryClear,
  memoryStore,
  newSession,
  parseConversion,
  recordConversion,
  restoreSession,
  setAngleMode,
  submit,
} from '../calculator';
import { isEnabled } from '../../../app/flags';
import { ruleText } from '../science/explain';
import { setSigFigMode, sigFigMode, watchSigFigMode } from '../science/mode';
import { sigFigCalculate } from '../science/sigfigs';
import { INSERT_EVENT } from '../flags';
import { AnswerActions, MatrixMode, Programmer, Statistics } from './CalculatorModes';
import { CALCULATOR_MODES, followCalculatorMode, saveCalculatorMode, savedCalculatorMode } from './calculatorMode';
import type { CalculatorMode } from './calculatorMode';
import { loadStored, saveStored, watchStored } from './storage';
import { useSelectedTabInView } from './tabScroll';
import styles from './tools.module.css';
import own from './calculator.module.css';

const Graph = lazy(() => import('../../math').then((loaded) => ({ default: loaded.GraphView })));
const STORE = 'calculator';
const GRAPH_STORE = 'calculator.graph';
const FIRST_GRAPH = 'y = sin(x)';
const GRAPH3D_STORE = 'calculator.graph3d';
const FIRST_GRAPH3D = 'z = sin(x) cos(y)';

/** What a tool asks the page to take: text for the caret, a graph for a code block, or a picture. */
export interface InsertDetail {
  text?: string;
  graph?: string;
  picture?: { bytes: ArrayBuffer; name: string; alt: string; mime: string };
  /** An equation for the page: LaTeX source and whether it stands on its own line. */
  math?: { source: string; display: boolean };
  /** A table for the page: a header row, then rows of cell text. */
  table?: { header: string[]; rows: string[][] };
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

/** The entry with its sign changed: -(entry), or the entry again when it already was. */
export function negate(entry: string): string {
  if (entry === '') return '-';
  return entry.startsWith('-(') && entry.endsWith(')') ? entry.slice(2, -1) : `-(${entry})`;
}

interface Answer {
  text: string;
  note?: string;
  /** The number and what was typed, so a change of notation rewrites the answer. */
  value?: number;
  expression?: string;
  /** The significant-figures rule that rounded the answer. */
  rule?: string;
}

const FORMAT_STORE = 'calculator.format';
const FIGURES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15];

interface FormatBarProps {
  format: AnswerFormat;
  typed: string;
  onChange(next: AnswerFormat): void;
}

/** How answers are written: normal, scientific, or engineering notation, and how many significant figures. */
function AnswerFormatBar({ format, typed, onChange }: FormatBarProps) {
  if (!isEnabled('math.steps')) return null;
  const least = leastSigFigs(typed);
  return (
    <div className={own.options}>
      <label className={styles.field}>
        <span>{t('mathTools.format.notation')}</span>
        <select
          value={format.notation}
          onChange={(event) => onChange({ ...format, notation: event.target.value as AnswerFormat['notation'] })}
        >
          <option value="auto">{t('mathTools.format.normal')}</option>
          <option value="scientific">{t('mathTools.format.scientific')}</option>
          <option value="engineering">{t('mathTools.format.engineering')}</option>
        </select>
      </label>
      <label className={styles.field}>
        <span>{t('mathTools.format.figures')}</span>
        <select
          value={String(format.figures)}
          aria-describedby={least === null ? undefined : 'calc-figures-typed'}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ ...format, figures: value === 'auto' || value === 'match' ? value : Number(value) });
          }}
        >
          <option value="auto">{t('mathTools.format.auto')}</option>
          <option value="match">{t('mathTools.format.match')}</option>
          {FIGURES.map((count) => (
            <option key={count} value={count}>
              {t('mathTools.format.count', { count })}
            </option>
          ))}
        </select>
      </label>
      {least === null ? null : (
        <p id="calc-figures-typed" className={styles.note}>
          {t('mathTools.format.typed', { count: least })}
        </p>
      )}
    </div>
  );
}

type Mode = CalculatorMode;
const FIRST_MODES: readonly Mode[] = ['scientific', 'graphing'];

/** The modes this build offers, in tab order. */
export function calculatorModes(): readonly Mode[] {
  return isEnabled('math.calcModes') ? CALCULATOR_MODES : FIRST_MODES;
}

/** The saved mode, when this build offers it, or Scientific. */
function shownMode(): Mode {
  const saved = savedCalculatorMode();
  return calculatorModes().find((mode) => mode === saved) ?? 'scientific';
}

function tabLabel(mode: Mode): string {
  if (!isEnabled('math.calcModes')) return t(`smart.tools.calculator.${mode as 'scientific' | 'graphing'}`);
  return t(`mathTools.calc.tabs.${mode}`);
}

export function CalculatorTool() {
  const modes = calculatorModes();
  // The last mode used comes back, in this window and in a popped-out one.
  const [tab, setTabState] = useState<Mode>(shownMode);
  useEffect(() => followCalculatorMode(() => setTabState(shownMode())), []);
  const setTab = (next: Mode) => {
    setTabState(next);
    saveCalculatorMode(next);
  };
  const tabs = useRef<HTMLDivElement>(null);
  useSelectedTabInView(tabs, tab);
  const move = (from: Mode, key: string): Mode | null => {
    const at = modes.indexOf(from);
    if (key === 'ArrowRight') return modes[(at + 1) % modes.length];
    if (key === 'ArrowLeft') return modes[(at - 1 + modes.length) % modes.length];
    if (key === 'Home') return modes[0];
    if (key === 'End') return modes[modes.length - 1];
    return null;
  };
  return (
    <div className={styles.tool}>
      <div ref={tabs} role="tablist" aria-label={t('smart.tools.calculator.tabs')} className={styles.tabs}>
        {modes.map((id) => (
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
              const next = move(id, event.key);
              if (!next) return;
              setTab(next);
              tabs.current?.querySelector<HTMLElement>(`#calc-tab-${next}`)?.focus();
              event.preventDefault();
            }}
          >
            {tabLabel(id)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`calc-panel-${tab}`} aria-labelledby={`calc-tab-${tab}`} className={styles.tool}>
        <ModePanel key={tab} mode={tab} />
      </div>
    </div>
  );
}

function ModePanel({ mode }: { mode: Mode }) {
  switch (mode) {
    case 'basic':
      return <Scientific basic />;
    case 'graphing':
      return <Graphing store={GRAPH_STORE} first={FIRST_GRAPH} />;
    case 'graphing3d':
      return <Graphing store={GRAPH3D_STORE} first={FIRST_GRAPH3D} />;
    case 'programmer':
      return <Programmer />;
    case 'statistics':
      return <Statistics />;
    case 'matrix':
      return <MatrixMode />;
    default:
      return <Scientific />;
  }
}

const BASIC_KEYS: readonly string[] = [
  'C',
  '±',
  '%',
  '÷',
  '7',
  '8',
  '9',
  '×',
  '4',
  '5',
  '6',
  '−',
  '1',
  '2',
  '3',
  '+',
  '0',
  '.',
  '⌫',
  '=',
];

interface BasicPadProps extends PadProps {
  onClear(): void;
  onNegate(): void;
  onBack(): void;
  onEquals(): void;
}

/** The four-function keypad: digits and signs go in, and C, the sign change, Backspace, and = act on the entry. */
function BasicKeypad({ onKey, onClear, onNegate, onBack, onEquals }: BasicPadProps) {
  const act: Record<string, () => void> = { C: onClear, '±': onNegate, '⌫': onBack, '=': onEquals };
  const names: Record<string, string> = {
    C: t('mathTools.calc.basic.clear'),
    '±': t('mathTools.calc.basic.negate'),
    '⌫': t('mathTools.calc.basic.back'),
    '=': t('mathTools.calc.basic.equals'),
  };
  return (
    <div className={own.basicKeys} role="group" aria-label={t('smart.tools.calculator.keypad')}>
      {BASIC_KEYS.map((key) => (
        <Button
          key={key}
          variant={key === '=' ? 'primary' : 'secondary'}
          aria-label={names[key]}
          onClick={() => (act[key] ? act[key]() : onKey(key))}
        >
          <span translate="no">{key}</span>
        </Button>
      ))}
    </div>
  );
}

/** The scientific and basic calculator's state: the session, what is typed, the answer, and how answers are written. */
function useScientific(basic: boolean) {
  const [session, setSession] = useState<CalcSession>(() => restoreSession(loadStored(STORE, null)));
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [format, setFormatState] = useState<AnswerFormat>(() => restoreAnswerFormat(loadStored(FORMAT_STORE, null)));
  const [problem, setProblem] = useState('');
  const [sig, setSig] = useState(sigFigMode);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => watchStored(STORE, () => setSession(restoreSession(loadStored(STORE, null)))), []);
  useEffect(() => watchSigFigMode(() => setSig(sigFigMode())), []);

  const keep = (next: CalcSession) => {
    setSession(next);
    saveStored(STORE, next);
  };
  const convert = (source: string) => {
    const converted = convertText(source);
    if (!converted) return false;
    if (converted.ok) {
      const unit = parseConversion(source)?.to.trim() ?? '';
      const text = unit === '' ? formatNumber(converted.value) : `${formatNumber(converted.value)} ${unit}`;
      keep(recordConversion(session, source, converted.value, unit));
      setAnswer({ text, note: t('smart.tools.calculator.converted', { input: source, value: text }) });
      setProblem('');
    } else setProblem(t('smart.tools.calculator.convertFailed'));
    return true;
  };
  const run = () => {
    const source = input.trim();
    if (source === '' || convert(source)) return;
    const done = submit(session, source.replace(/−/g, '-'));
    if (!done.result.ok) return setProblem(t(`smart.tools.calculator.errors.${done.result.error.code}`));
    const { value } = done.result;
    keep(done.session);
    const figured = sig && !basic ? sigFigCalculate(source.replace(/−/g, '-')) : null;
    if (figured?.ok) setAnswer({ text: figured.text, rule: ruleText(figured) });
    else
      setAnswer({ text: basic ? formatNumber(value) : formatAnswer(value, source, format), value, expression: source });
    setProblem('');
    setInput('');
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
  const setFormat = (next: AnswerFormat) => {
    setFormatState(next);
    saveStored(FORMAT_STORE, next);
    if (answer?.value !== undefined && answer.expression !== undefined)
      setAnswer({ ...answer, text: formatAnswer(answer.value, answer.expression, next) });
  };
  const clear = () => {
    setInput('');
    setAnswer(null);
    setProblem('');
  };
  return { session, keep, input, setInput, answer, problem, sig, field, run, type, format, setFormat, clear };
}

/** Scientific mode, or with `basic` the four-function calculator, which shares its history. */
function Scientific({ basic = false }: { basic?: boolean }) {
  const calc = useScientific(basic);
  const { session, keep, input, setInput, answer, problem, field, run, type } = calc;
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
      {answer?.rule ? <p className={styles.note}>{answer.rule}</p> : null}
      {answer ? <AnswerActions text={answer.text} /> : null}
      {basic ? (
        <BasicKeypad
          onKey={type}
          onClear={calc.clear}
          onNegate={() => setInput((old) => negate(old))}
          onBack={() => setInput((old) => old.slice(0, -1))}
          onEquals={run}
        />
      ) : (
        <>
          {isEnabled('tools.sigfigs') ? (
            <Switch
              label={t('science.sigfigs.mode')}
              checked={calc.sig}
              onChange={(on) => {
                setSigFigMode(on);
                announce(t(on ? 'science.sigfigs.modeOn' : 'science.sigfigs.modeOff'));
              }}
            />
          ) : null}
          <AnswerFormatBar format={calc.format} typed={answer?.expression ?? input} onChange={calc.setFormat} />
          <Keypad onKey={type} />
          <MemoryBar session={session} onChange={keep} onRecall={() => type('m1')} />
        </>
      )}
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
          <span translate="no">{key}</span>
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
      <div className={`${styles.buttons} ${own.flush}`}>
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
                    {t('smart.tools.calculator.answer', {
                      value: entry.unit ? `${formatNumber(entry.value)} ${entry.unit}` : formatNumber(entry.value),
                    })}
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

function Graphing({ store, first }: { store: string; first: string }) {
  const [source, setSource] = useState(() => loadStored<string>(store, first));
  const picture = async () => {
    const { graphPicture } = await import('../../math');
    const made = await graphPicture(source);
    if (!made) return announce(t('mathTools.graph3d.pictureFailed'));
    if (insertIntoPage({ picture: made })) announce(t('mathTools.graph3d.pictureAdded'));
  };
  return (
    <Suspense fallback={null}>
      <Graph
        source={source}
        editable
        onSource={(next) => {
          setSource(next);
          saveStored(store, next);
        }}
      />
      <div className={`${styles.buttons} ${own.flush}`}>
        <Button
          variant="quiet"
          onClick={() => insertIntoPage({ graph: source }) && announce(t('smart.tools.calculator.inserted'))}
        >
          {t('smart.tools.calculator.insert')}
        </Button>
        <Button variant="quiet" onClick={() => void picture()}>
          {t('mathTools.graph3d.picture')}
        </Button>
      </div>
    </Suspense>
  );
}

export { newSession };
