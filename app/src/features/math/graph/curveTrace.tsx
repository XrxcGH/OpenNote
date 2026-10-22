// The animated trace of a parametric or polar curve: a dot runs along the curve as t goes from the start of its range
// to the end, so the direction and speed of the motion show. Play and Pause run it; the t slider moves it by hand.
// When the system asks for reduced motion the dot never runs on its own, and the slider still moves it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t as tr } from '../../../strings/t';
import { Button } from '../../../ui';
import { classifyLine, compileSpecial, curvePoint, DEFAULT_T } from '../grapher/curves';
import { toPixel } from '../grapher';
import type { Viewport } from '../grapher';
import styles from './graph.module.css';
import { tidy } from '../space/vec';
import { PENS, SIZE, show } from './parts';

/** One lap of the dot, in milliseconds. */
const LAP_MS = 4000;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export interface CurveTraceState {
  /** The index of the first parametric or polar line, or -1 when there is none. */
  index: number;
  value: number;
  range: readonly [number, number];
  playing: boolean;
  setValue(next: number): void;
  toggle(): void;
}

/** The trace's state for a graph's lines. The dot follows the first parametric or polar curve. */
export function useCurveTrace(functions: readonly string[], range: readonly [number, number] | null | undefined) {
  const index = useMemo(
    () => functions.findIndex((line) => ['parametric', 'polar'].includes(classifyLine(line).kind)),
    [functions],
  );
  const span = range ?? DEFAULT_T;
  const [value, setValue] = useState(span[0]);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);
  useEffect(() => {
    if (!playing || index < 0) return;
    let last = performance.now();
    const step = (now: number) => {
      const delta = ((now - last) / LAP_MS) * (span[1] - span[0]);
      last = now;
      setValue((current) => {
        const next = current + delta;
        return next > span[1] ? span[0] : next;
      });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, index, span]);
  const clamped = Math.min(span[1], Math.max(span[0], value));
  return {
    index,
    value: clamped,
    range: span,
    playing,
    setValue,
    toggle: () => setPlaying((on) => !on && !prefersReducedMotion()),
  } satisfies CurveTraceState;
}

/** The traced point in graph units, or null. */
export function tracePoint(line: string, params: Readonly<Record<string, number>>, value: number) {
  const special = compileSpecial(line, params);
  return special.ok ? curvePoint(special.kind, special.parts, value, params) : null;
}

/** The dot on the plot. */
export function CurveDot(props: {
  state: CurveTraceState;
  functions: readonly string[];
  params: Readonly<Record<string, number>>;
  view: Viewport;
}) {
  const { state, functions, params, view } = props;
  if (state.index < 0) return null;
  const point = tracePoint(functions[state.index], params, state.value);
  if (!point) return null;
  const at = toPixel(view, SIZE, point);
  return (
    <circle
      className={styles.traceDot}
      cx={at.x}
      cy={at.y}
      r={6}
      style={{ fill: `var(${PENS[state.index % PENS.length]})` }}
    />
  );
}

/** Play or Pause, the t slider, and the point's place in words. */
export function CurveTraceControls(props: {
  state: CurveTraceState;
  functions: readonly string[];
  params: Readonly<Record<string, number>>;
}) {
  const { state, functions, params } = props;
  if (state.index < 0) return null;
  const point = tracePoint(functions[state.index], params, state.value);
  const reduced = prefersReducedMotion();
  const [from, to] = state.range;
  return (
    <div className={styles.trace}>
      {reduced ? null : (
        <Button variant="quiet" aria-pressed={state.playing} onClick={state.toggle}>
          {state.playing ? tr('graph3d.trace.pause') : tr('graph3d.trace.play')}
        </Button>
      )}
      <label className={styles.slider}>
        <span>{tr('graph3d.trace.variable')}</span>
        <input
          type="range"
          min={from}
          max={to}
          step={(to - from) / 400}
          value={state.value}
          aria-label={tr('graph3d.trace.slider')}
          onChange={(event) => state.setValue(Number(event.target.value))}
        />
        <output>{show(state.value)}</output>
      </label>
      <p className={styles.readout}>
        {point
          ? tr('graph3d.trace.point', { t: show(state.value), x: show(tidy(point.x)), y: show(tidy(point.y)) })
          : tr('graph3d.trace.undefined', { t: show(state.value) })}
      </p>
    </div>
  );
}
