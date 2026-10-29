// The calculator's programmer, statistics, and matrix modes, and the pieces every mode shares: Copy and Insert for
// the answer, and a history kept on this device that can be used again or cleared. The work is in calculator/
// (programmer.ts, statistics.ts, matrix.ts); these are their screens.
import { useEffect, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { formatNumber } from '../calculator/format';
import { addEntry, restoreEntries } from '../calculator/modeHistory';
import type { ModeEntry } from '../calculator/modeHistory';
import * as matrices from '../../../core/matrix';
import type { Matrix, MatrixError, MatrixResult } from '../../../core/matrix';
import { DEFAULT_PROGRAMMER, evaluateProgrammer, inBases, writeIn } from '../calculator/programmer';
import type { Base, ProgrammerOptions, WordSize } from '../calculator/programmer';
import { readData, regress, summarize } from '../calculator/statistics';
import { INSERT_EVENT } from '../flags';
import { loadStored, saveStored, watchStored } from './storage';
import styles from './tools.module.css';
import own from './calculator.module.css';

/** Hands text to the page that is open, which takes it at the caret. True when a page took it. */
export function insertText(text: string): boolean {
  const request = { text, handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: request }));
  return request.handled;
}

export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).then(
    () => announce(t('smart.tools.calculator.copied')),
    () => undefined,
  );
}

/** Copy and Insert for an answer. */
export function AnswerActions({ text }: { text: string }) {
  return (
    <div className={`${styles.buttons} ${own.flush}`}>
      <Button variant="quiet" onClick={() => copyText(text)}>
        {t('smart.tools.calculator.copy')}
      </Button>
      <Button variant="quiet" onClick={() => insertText(text) && announce(t('smart.tools.calculator.inserted'))}>
        {t('smart.tools.calculator.insert')}
      </Button>
    </div>
  );
}

/** A mode's history, saved under its own name and followed across the app's windows. */
export function useModeHistory(name: string) {
  const [entries, setEntries] = useState<ModeEntry[]>(() => restoreEntries(loadStored(name, [])));
  useEffect(() => watchStored(name, () => setEntries(restoreEntries(loadStored(name, [])))), [name]);
  const keep = (next: ModeEntry[]) => {
    setEntries(next);
    saveStored(name, next);
  };
  return {
    entries,
    add: (input: string, output: string) => keep(addEntry(entries, input, output)),
    clear: () => keep([]),
  };
}

interface HistoryListProps {
  id: string;
  entries: readonly ModeEntry[];
  onUse(input: string): void;
  onClear(): void;
}

export function ModeHistoryList({ id, entries, onUse, onClear }: HistoryListProps) {
  return (
    <section aria-labelledby={`${id}-history`}>
      <h3 id={`${id}-history`} className={styles.groupTitle}>
        {t('smart.tools.calculator.history')}
      </h3>
      {entries.length === 0 ? (
        <p className={styles.empty}>{t('smart.tools.calculator.historyEmpty')}</p>
      ) : (
        <>
          <ul className={styles.items}>
            {[...entries]
              .reverse()
              .slice(0, 30)
              .map((entry) => (
                <li key={entry.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.link}
                    aria-label={t('smart.tools.calculator.useEntry', { expression: entry.input })}
                    onClick={() => onUse(entry.input)}
                  >
                    {entry.input.length > 60 ? `${entry.input.slice(0, 60)}…` : entry.input}
                  </button>
                  <span className={styles.itemDue}>{entry.output}</span>
                </li>
              ))}
          </ul>
          <Button variant="quiet" onClick={onClear}>
            {t('smart.tools.calculator.clearHistory')}
          </Button>
        </>
      )}
    </section>
  );
}

function Status({ problem, children }: { problem: string; children?: ReactNode }) {
  return (
    <div className={styles.result} role="status">
      {problem ? <span className={styles.problem}>{problem}</span> : children}
    </div>
  );
}

// Programmer

const BASES: readonly { base: Base; key: 'hex' | 'dec' | 'oct' | 'bin'; prefix: string }[] = [
  { base: 16, key: 'hex', prefix: '0x' },
  { base: 10, key: 'dec', prefix: '' },
  { base: 8, key: 'oct', prefix: '0o' },
  { base: 2, key: 'bin', prefix: '0b' },
];
const PROGRAMMER_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'and', 'or', 'xor', 'not', '<<', '>>', '(', ')', 'mod'];

function restoreOptions(raw: unknown): ProgrammerOptions {
  const saved = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ProgrammerOptions>;
  return {
    base: ([2, 8, 10, 16] as const).find((base) => base === saved.base) ?? DEFAULT_PROGRAMMER.base,
    bits: ([8, 16, 32, 64] as const).find((bits) => bits === saved.bits) ?? DEFAULT_PROGRAMMER.bits,
    signed: typeof saved.signed === 'boolean' ? saved.signed : DEFAULT_PROGRAMMER.signed,
  };
}

export function Programmer() {
  const [options, setOptions] = useState(() => restoreOptions(loadStored('calculator.programmerOptions', null)));
  const [input, setInput] = useState('');
  const [value, setValue] = useState<bigint | null>(null);
  const [problem, setProblem] = useState('');
  const history = useModeHistory('calculator.programmer');
  const choose = (next: Partial<ProgrammerOptions>) => {
    const merged = { ...options, ...next };
    setOptions(merged);
    saveStored('calculator.programmerOptions', merged);
    // A value on screen stays the same number in the new base or word.
    if (value !== null && next.base !== undefined) setInput(writeIn(value, merged));
  };
  const run = () => {
    const result = evaluateProgrammer(input, options);
    if (!result.ok) {
      setProblem(t(`mathTools.calc.programmer.errors.${result.error}`));
      return;
    }
    setProblem('');
    setValue(result.value);
    const texts = inBases(result.value, options);
    history.add(input.trim(), `= ${texts.dec} (0x${texts.hex.replace(/ /g, '')})`);
  };
  const texts = value === null ? null : inBases(value, options);
  const shown = value === null ? '' : `${BASES.find((b) => b.base === options.base)!.prefix}${writeIn(value, options)}`;
  return (
    <>
      <div className={own.options}>
        <label className={styles.field}>
          <span>{t('mathTools.calc.programmer.base')}</span>
          <select value={options.base} onChange={(event) => choose({ base: Number(event.target.value) as Base })}>
            {BASES.map(({ base, key }) => (
              <option key={base} value={base}>
                {t(`mathTools.calc.programmer.${key}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('mathTools.calc.programmer.word')}</span>
          <select value={options.bits} onChange={(event) => choose({ bits: Number(event.target.value) as WordSize })}>
            {[8, 16, 32, 64].map((bits) => (
              <option key={bits} value={bits}>
                {t('mathTools.calc.programmer.bits', { bits })}
              </option>
            ))}
          </select>
        </label>
        <label className={own.check}>
          <input
            type="checkbox"
            checked={options.signed}
            onChange={(event) => choose({ signed: event.target.checked })}
          />
          <span>{t('mathTools.calc.programmer.signed')}</span>
        </label>
      </div>
      <Entry
        value={input}
        label={t('smart.tools.calculator.expression')}
        placeholder={t('mathTools.calc.programmer.placeholder')}
        invalid={problem !== ''}
        onChange={setInput}
        onRun={run}
      />
      <Status problem={problem}>
        {texts ? (
          <dl className={own.bases} aria-label={t('mathTools.calc.programmer.inBases')}>
            {BASES.map(({ key }) => (
              <div key={key} style={{ display: 'contents' }}>
                <dt>{t(`mathTools.calc.programmer.${key}`)}</dt>
                <dd translate="no">{texts[key]}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Status>
      {value !== null ? <AnswerActions text={shown} /> : null}
      <div className={own.hexKeys} role="group" aria-label={t('smart.tools.calculator.keypad')}>
        {PROGRAMMER_KEYS.map((key) => (
          <Button
            key={key}
            variant="secondary"
            disabled={/^[A-F]$/.test(key) && options.base !== 16}
            onClick={() =>
              setInput((old) =>
                /^[A-F]$/.test(key) ? old + key : `${old}${old && !old.endsWith(' ') ? ' ' : ''}${key} `,
              )
            }
          >
            <span translate="no">{key}</span>
          </Button>
        ))}
      </div>
      <ModeHistoryList id="calc-programmer" entries={history.entries} onUse={setInput} onClear={history.clear} />
    </>
  );
}

interface EntryProps {
  value: string;
  label: string;
  placeholder: string;
  invalid: boolean;
  onChange(value: string): void;
  onRun(): void;
}

function Entry({ value, label, placeholder, invalid, onChange, onRun }: EntryProps) {
  return (
    <div className={styles.entry}>
      <label className={styles.field}>
        <span>{label}</span>
        <input
          className={styles.expression}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) onRun();
          }}
        />
      </label>
      <Button variant="primary" onClick={onRun}>
        {t('smart.tools.calculator.calculate')}
      </Button>
    </div>
  );
}

// Statistics

interface StatsRow {
  label: MessageKey;
  value: string;
}

const num = (value: number) => (Number.isFinite(value) ? formatNumber(value) : '—');

function statsRows(text: string): { rows: StatsRow[]; line: string | null } | { problem: string } {
  const read = readData(text);
  if (!read.ok) {
    return {
      problem:
        read.error === 'empty'
          ? t('mathTools.calc.stats.empty')
          : t('mathTools.calc.stats.notNumber', { text: read.text }),
    };
  }
  const summary = summarize(read.data.xs)!;
  const rows: StatsRow[] = [
    { label: 'mathTools.calc.stats.count', value: String(summary.count) },
    { label: 'mathTools.calc.stats.sum', value: num(summary.sum) },
    { label: 'mathTools.calc.stats.mean', value: num(summary.mean) },
    { label: 'mathTools.calc.stats.median', value: num(summary.median) },
    {
      label: 'mathTools.calc.stats.mode',
      value: summary.modes.length === 0 ? t('mathTools.calc.stats.noMode') : summary.modes.map(num).join(', '),
    },
    { label: 'mathTools.calc.stats.min', value: num(summary.min) },
    { label: 'mathTools.calc.stats.max', value: num(summary.max) },
    { label: 'mathTools.calc.stats.range', value: num(summary.range) },
    { label: 'mathTools.calc.stats.q1', value: num(summary.q1) },
    { label: 'mathTools.calc.stats.q3', value: num(summary.q3) },
    { label: 'mathTools.calc.stats.iqr', value: num(summary.iqr) },
    { label: 'mathTools.calc.stats.sampleSd', value: num(summary.sampleSd) },
    { label: 'mathTools.calc.stats.populationSd', value: num(summary.populationSd) },
    { label: 'mathTools.calc.stats.sampleVariance', value: num(summary.sampleVariance) },
  ];
  let line: string | null = null;
  if (read.data.ys) {
    const fit = regress(read.data.xs, read.data.ys);
    if (fit) {
      const sign = fit.intercept < 0 ? '-' : '+';
      line = `y = ${num(fit.slope)}x ${sign} ${num(Math.abs(fit.intercept))}`;
      rows.push(
        { label: 'mathTools.calc.stats.slope', value: num(fit.slope) },
        { label: 'mathTools.calc.stats.intercept', value: num(fit.intercept) },
        { label: 'mathTools.calc.stats.r', value: num(fit.r) },
        { label: 'mathTools.calc.stats.r2', value: num(fit.r2) },
      );
    }
  }
  return { rows, line };
}

export function Statistics() {
  const [data, setData] = useState('');
  const [shown, setShown] = useState<ReturnType<typeof statsRows> | null>(null);
  const history = useModeHistory('calculator.statistics');
  const run = () => {
    const next = statsRows(data);
    setShown(next);
    if ('rows' in next) {
      const mean = next.rows.find((row) => row.label === 'mathTools.calc.stats.mean')!.value;
      history.add(data.trim(), t('mathTools.calc.stats.historyLine', { count: next.rows[0].value, mean }));
    }
  };
  const summaryText =
    shown && 'rows' in shown
      ? [...shown.rows.map((row) => `${t(row.label)}: ${row.value}`), ...(shown.line ? [shown.line] : [])].join('; ')
      : '';
  return (
    <>
      <label className={styles.field}>
        <span>{t('mathTools.calc.stats.data')}</span>
        <textarea
          className={own.data}
          value={data}
          placeholder={t('mathTools.calc.stats.placeholder')}
          spellCheck={false}
          aria-invalid={shown && 'problem' in shown ? true : undefined}
          aria-describedby="calc-stats-note"
          onChange={(event) => setData(event.target.value)}
        />
      </label>
      <p id="calc-stats-note" className={styles.note}>
        {t('mathTools.calc.stats.note')}
      </p>
      <div className={styles.buttons}>
        <Button variant="primary" onClick={run}>
          {t('smart.tools.calculator.calculate')}
        </Button>
      </div>
      <Status problem={shown && 'problem' in shown ? shown.problem : ''}>
        {shown && 'rows' in shown ? (
          <table className={own.table} aria-label={t('mathTools.calc.stats.results')}>
            <tbody>
              {shown.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{t(row.label)}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
              {shown.line ? (
                <tr>
                  <th scope="row">{t('mathTools.calc.stats.line')}</th>
                  <td>{shown.line}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}
      </Status>
      {summaryText ? <AnswerActions text={summaryText} /> : null}
      <ModeHistoryList id="calc-stats" entries={history.entries} onUse={setData} onClear={history.clear} />
    </>
  );
}

// Matrix

type MatrixOp = 'add' | 'subtract' | 'multiply' | 'det' | 'inverse' | 'transpose' | 'rank' | 'rref' | 'solve';
const MATRIX_OPS: readonly MatrixOp[] = [
  'add',
  'subtract',
  'multiply',
  'det',
  'inverse',
  'transpose',
  'rank',
  'rref',
  'solve',
];

type MatrixAnswer = { kind: 'number'; value: number } | { kind: 'matrix'; value: Matrix };

function runMatrix(
  op: MatrixOp,
  aText: string,
  bText: string,
): MatrixResult<MatrixAnswer> | { ok: false; error: 'readA' | 'readB'; why: MatrixError } {
  const a = matrices.readMatrix(aText);
  if (!a.ok) return { ok: false, error: 'readA', why: a.error };
  const needsB = op === 'add' || op === 'subtract' || op === 'multiply' || op === 'solve';
  const b = needsB ? matrices.readMatrix(bText) : null;
  if (b && !b.ok) return { ok: false, error: 'readB', why: b.error };
  const B = b?.ok ? b.value : [];
  const asMatrix = (result: MatrixResult<Matrix>): MatrixResult<MatrixAnswer> =>
    result.ok ? { ok: true, value: { kind: 'matrix', value: result.value } } : result;
  switch (op) {
    case 'add':
      return asMatrix(matrices.add(a.value, B));
    case 'subtract':
      return asMatrix(matrices.add(a.value, B, -1));
    case 'multiply':
      return asMatrix(matrices.multiply(a.value, B));
    case 'solve':
      return asMatrix(matrices.solve(a.value, B));
    case 'inverse':
      return asMatrix(matrices.inverse(a.value));
    case 'transpose':
      return { ok: true, value: { kind: 'matrix', value: matrices.transpose(a.value) } };
    case 'rref':
      return { ok: true, value: { kind: 'matrix', value: matrices.rref(a.value) } };
    case 'rank':
      return { ok: true, value: { kind: 'number', value: matrices.rank(a.value) } };
    case 'det': {
      const det = matrices.determinant(a.value);
      return det.ok ? { ok: true, value: { kind: 'number', value: det.value } } : det;
    }
  }
}

const oneLine = (m: Matrix) => `[${matrices.writeMatrix(m).replace(/\n/g, '; ')}]`;

export function MatrixMode() {
  const [a, setA] = useState('1 2\n3 4');
  const [b, setB] = useState('5\n6');
  const [answer, setAnswer] = useState<MatrixAnswer | null>(null);
  const [problem, setProblem] = useState('');
  const history = useModeHistory('calculator.matrix');
  const run = (op: MatrixOp) => {
    const result = runMatrix(op, a, b);
    if (!result.ok) {
      setAnswer(null);
      if (result.error === 'readA' || result.error === 'readB') {
        setProblem(
          t(`mathTools.calc.matrix.${result.error}`, { why: t(`mathTools.calc.matrix.errors.${result.why}`) }),
        );
      } else setProblem(t(`mathTools.calc.matrix.errors.${result.error}`));
      return;
    }
    setProblem('');
    setAnswer(result.value);
    const text = result.value.kind === 'number' ? formatNumber(result.value.value) : oneLine(result.value.value);
    const parsed = matrices.readMatrix(a);
    history.add(`${t(`mathTools.calc.matrix.ops.${op}`)}: A = ${parsed.ok ? oneLine(parsed.value) : a}`, text);
  };
  const answerText = answer ? (answer.kind === 'number' ? formatNumber(answer.value) : oneLine(answer.value)) : '';
  return (
    <>
      <div className={own.pair}>
        <label className={styles.field}>
          <span>{t('mathTools.calc.matrix.a')}</span>
          <textarea className={own.data} value={a} spellCheck={false} onChange={(event) => setA(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>{t('mathTools.calc.matrix.b')}</span>
          <textarea className={own.data} value={b} spellCheck={false} onChange={(event) => setB(event.target.value)} />
        </label>
      </div>
      <p className={styles.note}>{t('mathTools.calc.matrix.note')}</p>
      <div className={own.ops} role="group" aria-label={t('mathTools.calc.matrix.operations')}>
        {MATRIX_OPS.map((op) => (
          <Button key={op} variant="secondary" onClick={() => run(op)}>
            {t(`mathTools.calc.matrix.ops.${op}`)}
          </Button>
        ))}
      </div>
      <Status problem={problem}>
        {answer?.kind === 'number' ? (
          <strong>{t('smart.tools.calculator.answer', { value: formatNumber(answer.value) })}</strong>
        ) : answer ? (
          <table className={`${own.table} ${own.matrix}`} aria-label={t('mathTools.calc.matrix.result')}>
            <tbody>
              {answer.value.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{formatNumber(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Status>
      {answer ? (
        <>
          <AnswerActions text={answerText} />
          {answer.kind === 'matrix' ? (
            <div className={styles.buttons}>
              <Button variant="quiet" onClick={() => setA(matrices.writeMatrix(answer.value))}>
                {t('mathTools.calc.matrix.useAsA')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      <ModeHistoryList
        id="calc-matrix"
        entries={history.entries}
        onUse={(input) => {
          const found = /A = \[(.*)\]$/.exec(input);
          if (found) setA(found[1].replace(/; /g, '\n'));
        }}
        onClear={history.clear}
      />
    </>
  );
}
