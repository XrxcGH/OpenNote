// Pieces every tool of the kit shares: fields that keep their text between visits, an equation drawn by KaTeX, the
// worked steps as a numbered list, a small line plot, and the buttons that put the work into the page.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { insertIntoPage } from '../../ui/insert';
import { loadStored, saveStored } from '../../ui/storage';
import { KitError, type KitStep } from '../types';
import styles from './mathkit.module.css';

/** t for keys built at run time, such as a step's key. Each key exists in strings/en/kitMath.ts. */
export const say = t as unknown as (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** State saved on this device under the tool's name, merged over the first values so new fields appear. */
export function useStored<T extends object>(name: string, first: T): [T, (patch: Partial<T>) => void] {
  const [state, setState] = useState<T>(() => ({ ...first, ...loadStored<Partial<T>>(`kitmath.${name}`, {}) }));
  useEffect(() => saveStored(`kitmath.${name}`, state), [name, state]);
  return [state, (patch) => setState((current) => ({ ...current, ...patch }))];
}

/** The words for a problem a tool ran into. */
export function describe(error: unknown): string {
  if (error instanceof KitError) {
    try {
      return say(`kitMath.error.${error.code}`, { detail: error.detail });
    } catch {
      return say('kitMath.error.unknown');
    }
  }
  return say('kitMath.error.unknown');
}

/** Runs a tool again only when its input changes. It gives the result, or else the words for what went wrong. */
export function useSolved<I, R>(input: I, run: (input: I) => R): { result: R | null; problem: string } {
  const key = JSON.stringify(input);
  return useMemo(() => {
    try {
      return { result: run(input), problem: '' };
    } catch (error) {
      return { result: null, problem: describe(error) };
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

type Renderer = (latex: string, options?: { displayMode?: boolean }) => { ok: true; html: string } | { ok: false };

let renderer: Renderer | null = null;
let loading: Promise<void> | null = null;

/** KaTeX is large, so it loads when the first equation is drawn and not with the rest of the tools. */
function useRenderer(): Renderer | null {
  const [render, setRender] = useState<Renderer | null>(() => renderer);
  useEffect(() => {
    if (renderer) return;
    loading ??= import('../../../math').then((math) => {
      renderer = math.renderLatex as Renderer;
    });
    let live = true;
    void loading.then(() => live && setRender(() => renderer));
    return () => {
      live = false;
    };
  }, []);
  return render;
}

/** An equation: drawn when KaTeX has loaded, and its LaTeX source in the meantime. */
export function MathView({ latex, display = true }: { latex: string; display?: boolean }) {
  const render = useRenderer();
  const drawn = useMemo(() => (render ? render(latex, { displayMode: display }) : null), [render, latex, display]);
  if (drawn && drawn.ok) {
    return <div className={styles.math} dangerouslySetInnerHTML={{ __html: drawn.html }} />;
  }
  return <code className={styles.mono}>{latex}</code>;
}

/** A step in words. */
export function stepText(item: KitStep): string {
  const vars: Record<string, string> = {};
  // A variable named $name holds a message key, so the engine can name a kind or a method without words.
  for (const [name, value] of Object.entries(item.vars ?? {})) {
    if (name.startsWith('$')) vars[name.slice(1)] = say(value);
    else vars[name] = value;
  }
  return say(`kitMath.step.${item.key}`, vars);
}

export function Steps({ steps }: { steps: readonly KitStep[] }) {
  if (steps.length === 0) return null;
  return (
    <section className={styles.section} aria-label={t('kitMath.ui.steps')}>
      <h3 className={styles.heading}>{t('kitMath.ui.steps')}</h3>
      <ol className={styles.stepList}>
        {steps.map((item, index) => (
          <li key={index}>
            <span>{stepText(item)}</span>
            {item.math ? <MathView latex={item.math} /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  invalid?: boolean;
  hint?: string;
  wide?: boolean;
  rows?: number;
}) {
  const id = useId();
  const base = props.mono === false ? styles.input : `${styles.input} ${styles.mono}`;
  const className = props.rows ? `${base} ${styles.textarea}` : base;
  return (
    <div className={props.wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{props.label}</label>
      {props.rows ? (
        <textarea
          id={id}
          className={className}
          rows={props.rows}
          value={props.value}
          spellCheck={false}
          aria-invalid={props.invalid ? true : undefined}
          {...(props.hint ? { 'aria-description': props.hint } : {})}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          className={className}
          value={props.value}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={props.invalid ? true : undefined}
          {...(props.hint ? { 'aria-description': props.hint } : {})}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={props.wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        className={styles.input}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export const Problem = ({ text }: { text: string }) => (
  <p className={styles.problem} role="alert">
    {text}
  </p>
);

export const Note = ({ children }: { children: ReactNode }) => <p className={styles.note}>{children}</p>;

/** The result line, readable as text. */
export const Result = ({ children }: { children: ReactNode }) => (
  <p className={styles.result} aria-live="polite">
    {children}
  </p>
);

/** The buttons that put an answer, an equation, the steps, or a table into the page that is open. */
export function InsertBar(props: {
  answer?: string;
  latex?: string;
  steps?: readonly KitStep[];
  table?: { header: string[]; rows: string[][] };
}) {
  const done = (ok: boolean) => announce(t(ok ? 'kitMath.ui.inserted' : 'kitMath.ui.noPage'));
  const { answer, latex, steps, table } = props;
  return (
    <div className={styles.actions}>
      {answer ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ text: answer }))}>
          {t('kitMath.ui.insertAnswer')}
        </Button>
      ) : null}
      {latex ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ math: { source: latex, display: true } }))}>
          {t('kitMath.ui.insertEquation')}
        </Button>
      ) : null}
      {steps && steps.length ? (
        <Button
          variant="quiet"
          onClick={() =>
            done(
              insertIntoPage({
                text: steps
                  .map((item, index) => `${index + 1}. ${stepText(item)}${item.math ? ` ${item.math}` : ''}`)
                  .join('\n'),
              }),
            )
          }
        >
          {t('kitMath.ui.insertSteps')}
        </Button>
      ) : null}
      {table ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ table }))}>
          {t('kitMath.ui.insertTable')}
        </Button>
      ) : null}
    </div>
  );
}

export interface Series {
  readonly points: readonly (readonly [number, number])[];
  readonly tone?: number;
  readonly dots?: boolean;
  readonly dashed?: boolean;
}

const PENS = ['--ink-indigo', '--ink-amber', '--ink-fern', '--ink-brick', '--ink-plum', '--ink-walnut'];

/** A quiet line plot on the page color, fitted to its data, with a name for assistive technology. */
export function LinePlot({
  series,
  label,
  equal = false,
  logx = false,
  logy = false,
}: {
  series: readonly Series[];
  label: string;
  equal?: boolean;
  logx?: boolean;
  logy?: boolean;
}) {
  const W = 480;
  const H = 300;
  const pad = 34;
  const fx = (v: number) => (logx ? Math.log10(Math.max(v, 1e-300)) : v);
  const fy = (v: number) => (logy ? Math.log10(Math.max(v, 1e-300)) : v);
  const all = series.flatMap((one) => one.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (all.length === 0) return null;
  let x0 = Math.min(...all.map((p) => fx(p[0])));
  let x1 = Math.max(...all.map((p) => fx(p[0])));
  let y0 = Math.min(...all.map((p) => fy(p[1])));
  let y1 = Math.max(...all.map((p) => fy(p[1])));
  if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
  if (equal) {
    const span = Math.max(x1 - x0, y1 - y0);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    [x0, x1, y0, y1] = [cx - span / 2, cx + span / 2, cy - span / 2, cy + span / 2];
  }
  const tickText = (v: number, log: boolean) => (log ? `1e${Math.round(v)}` : Number(v.toPrecision(3)).toString());
  // Leave room on the left for the longest label on the vertical axis.
  const padL = Math.max(pad, 12 + 6.5 * Math.max(tickText(y0, logy).length, tickText(y1, logy).length));
  const px = (x: number) => padL + ((fx(x) - x0) / (x1 - x0)) * (W - padL - pad);
  const py = (y: number) => H - pad - ((fy(y) - y0) / (y1 - y0)) * (H - 2 * pad);
  const tick = tickText;
  const zeroX = !logx && x0 < 0 && x1 > 0 ? px(0) : null;
  const zeroY = !logy && y0 < 0 && y1 > 0 ? py(0) : null;
  return (
    <svg className={styles.plot} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect
        x={padL}
        y={pad / 2}
        width={W - padL - pad}
        height={H - pad - pad / 2}
        fill="none"
        stroke="var(--color-border-subtle)"
      />
      {zeroX !== null ? (
        <line x1={zeroX} x2={zeroX} y1={pad / 2} y2={H - pad} stroke="var(--color-border-control)" />
      ) : null}
      {zeroY !== null ? (
        <line x1={padL} x2={W - pad} y1={zeroY} y2={zeroY} stroke="var(--color-border-control)" />
      ) : null}
      <g fill="var(--color-text-muted)" fontSize="10">
        <text x={padL} y={H - pad + 14}>
          {tick(x0, logx)}
        </text>
        <text x={W - pad} y={H - pad + 14} textAnchor="end">
          {tick(x1, logx)}
        </text>
        <text x={padL - 4} y={H - pad} textAnchor="end">
          {tick(y0, logy)}
        </text>
        <text x={padL - 4} y={pad / 2 + 8} textAnchor="end">
          {tick(y1, logy)}
        </text>
      </g>
      {series.map((one, index) => {
        const color = `var(${PENS[(one.tone ?? index) % PENS.length]})`;
        const pts = one.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
        return (
          <g key={index} stroke={color} fill={color}>
            {one.dots ? (
              pts.map((p, at) => <circle key={at} cx={px(p[0])} cy={py(p[1])} r={3} stroke="none" />)
            ) : (
              <polyline
                fill="none"
                strokeWidth={1.8}
                {...(one.dashed ? { strokeDasharray: '5 4' } : {})}
                points={pts.map((p) => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ')}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
