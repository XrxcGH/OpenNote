// Convolution, sampling, and discrete systems: one tab per mode. Convolution shows the flip and shift at a chosen
// n beside the full table; correlation finds a delay; a difference equation runs from rest and shows its poles.
// The sampling, quantization, rate-change, and continuous modes are in SamplingModes.tsx.
import { useMemo, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import { fmt, fmtComplex, readNumbers } from '../shared/num';
import { Plot, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Choice,
  DataTable,
  Field,
  Fields,
  InsertMenu,
  Problem,
  Results,
  StepList,
  Tabs,
  attempt,
  num,
  useStored,
  type TableData,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import { convolve, crossCorrelate, impulse, rowText, runDifference, unitStep } from './engine';
import { ContinuousMode, QuantizationMode, RateMode, SamplingMode } from './SamplingModes';

type Mode = 'convolution' | 'correlation' | 'difference' | 'sampling' | 'quantization' | 'rate' | 'continuous';
const MODES: readonly Mode[] = ['convolution', 'correlation', 'difference', 'sampling', 'quantization', 'rate', 'continuous'];

const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);

function ConvolutionMode() {
  const [state, set] = useStored('systems.convolution', { x: '1, 2, 3', h: '0, 1, 0.5', xStart: '0', hStart: '0' });
  const [shift, setShift] = useState<number | null>(null);
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () => attempt(() => convolve(readNumbers(state.x), readNumbers(state.h), num(state.xStart) || 0, num(state.hStart) || 0)),
    [state],
  );
  const fields = (
    <Fields>
      <Field label={t('kitSignals.systems.x')} value={state.x} onChange={(x) => set({ x })} hint={t('kitSignals.systems.sequenceHint')} />
      <Field label={t('kitSignals.systems.h')} value={state.h} onChange={(h) => set({ h })} />
      <Field label={t('kitSignals.systems.xStart')} value={state.xStart} onChange={(xStart) => set({ xStart })} />
      <Field label={t('kitSignals.systems.hStart')} value={state.hStart} onChange={(hStart) => set({ hStart })} />
    </Fields>
  );
  if (!outcome.ok) return <>{fields}<Problem text={outcome.problem} /></>;
  const result = outcome.value;
  const x = readNumbers(state.x);
  const h = readNumbers(state.h);
  const xStart = num(state.xStart) || 0;
  const hStart = num(state.hStart) || 0;
  const n = Math.min(result.start + result.y.length - 1, Math.max(result.start, shift ?? result.start + 1));
  const flippedIndex = range(n - hStart - h.length + 1, h.length);
  const table: TableData = {
    header: [t('kitSignals.systems.nHeader'), t('kitSignals.systems.termsHeader'), t('kitSignals.systems.sumHeader')],
    rows: result.rows.map((row) => [String(row.n), rowText(row).split(' = ')[1] ?? '', fmt(row.sum)]),
  };
  const answer = t('kitSignals.systems.answer', { values: result.y.map((v) => fmt(v)).join(', '), start: result.start });
  return (
    <>
      {fields}
      <Answer text={answer} />
      <label className={styles.field}>
        <span>{t('kitSignals.systems.shift')}</span>
        <input
          type="range"
          min={result.start}
          max={result.start + result.y.length - 1}
          value={n}
          aria-valuetext={t('kitSignals.systems.shiftValue', { n })}
          onChange={(event) => setShift(Number(event.target.value))}
        />
      </label>
      <Plot
        title={t('kitSignals.systems.overlapTitle', { n })}
        spec={{
          series: [
            { label: 'x[k]', x: range(xStart, x.length), y: x, kind: 'stem' },
            { label: `h[${n} − k]`, x: flippedIndex, y: [...h].reverse(), kind: 'stem', tone: 1 },
          ],
          xLabel: 'k',
          yLabel: t('kitSignals.systems.valueAxis'),
        }}
      />
      <Results rows={[[`y[${n}]`, rowText(result.rows[n - result.start]!)]]} />
      <Plot
        ref={plot}
        title={t('kitSignals.systems.outputTitle')}
        spec={{
          series: [{ label: 'y[n]', x: range(result.start, result.y.length), y: result.y, kind: 'stem', tone: 2 }],
          xLabel: 'n',
          yLabel: 'y[n]',
          markers: [{ x: n, label: `n = ${n}` }],
        }}
      />
      <DataTable caption={t('kitSignals.systems.tableTitle')} table={table} />
      <StepList steps={result.steps} />
      <InsertMenu
        answer={answer}
        latex={String.raw`y[n] = \sum_{k} x[k]\, h[n-k]`}
        table={table}
        steps={result.steps}
        picture={() => plot.current?.picture('convolution') ?? Promise.resolve(null)}
      />
    </>
  );
}

function CorrelationMode() {
  const [state, set] = useStored('systems.correlation', { x: '0.2, 1, -0.5, 0.8, 0.1', y: '0, 0, 0, 0.2, 1, -0.5, 0.8, 0.1' });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(() => attempt(() => crossCorrelate(readNumbers(state.x), readNumbers(state.y))), [state]);
  return (
    <>
      <Fields>
        <Field label={t('kitSignals.systems.x')} value={state.x} onChange={(x) => set({ x })} wide />
        <Field label={t('kitSignals.systems.y')} value={state.y} onChange={(y) => set({ y })} wide />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={t('kitSignals.systems.lagAnswer', { lag: outcome.value.peakLag })} />
          <Plot
            ref={plot}
            title={t('kitSignals.systems.modes.correlation')}
            spec={{
              series: [{ label: 'r[l]', x: outcome.value.lags, y: outcome.value.r, kind: 'stem' }],
              xLabel: t('kitSignals.systems.lagAxis'),
              yLabel: t('kitSignals.systems.rAxis'),
              markers: [{ x: outcome.value.peakLag, label: `l = ${outcome.value.peakLag}` }],
            }}
          />
          <StepList steps={outcome.value.steps} />
          <InsertMenu
            answer={t('kitSignals.systems.lagAnswer', { lag: outcome.value.peakLag })}
            latex={String.raw`r_{xy}[l] = \sum_n y[n]\, x[n-l]`}
            steps={outcome.value.steps}
            picture={() => plot.current?.picture('correlation') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

type InputKind = 'impulse' | 'step' | 'custom';

function DifferenceMode() {
  const [state, set] = useStored('systems.difference', {
    b: '1',
    a: '1, -0.5',
    input: 'impulse' as InputKind,
    custom: '1, 0, 0, 1',
    length: '16',
  });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const length = Math.min(512, Math.max(1, Math.round(num(state.length)) || 16));
        const x =
          state.input === 'impulse' ? impulse(length)
          : state.input === 'step' ? unitStep(length)
          : readNumbers(state.custom);
        return runDifference(readNumbers(state.b), readNumbers(state.a), x);
      }),
    [state],
  );
  const fields = (
    <Fields>
      <Field label={t('kitSignals.systems.b')} value={state.b} onChange={(b) => set({ b })} hint={t('kitSignals.systems.abHint')} />
      <Field label={t('kitSignals.systems.a')} value={state.a} onChange={(a) => set({ a })} />
      <Choice
        label={t('kitSignals.systems.input')}
        value={state.input}
        options={['impulse', 'step', 'custom'] as const}
        name={(kind) => t(`kitSignals.systems.inputs.${kind}`)}
        onChange={(input) => set({ input })}
      />
      {state.input === 'custom' ? (
        <Field label={t('kitSignals.systems.custom')} value={state.custom} onChange={(custom) => set({ custom })} />
      ) : (
        <Field label={t('kitSignals.systems.length')} value={state.length} onChange={(length) => set({ length })} />
      )}
    </Fields>
  );
  if (!outcome.ok) return <>{fields}<Problem text={outcome.problem} /></>;
  const result = outcome.value;
  const answer = t(result.stable ? 'kitSignals.systems.stableAnswer' : 'kitSignals.systems.unstableAnswer');
  const table: TableData = { header: ['n', 'y[n]'], rows: result.y.map((v, n) => [String(n), fmt(v)]) };
  return (
    <>
      {fields}
      <Answer text={answer} />
      <Plot
        ref={plot}
        title={t('kitSignals.systems.responseTitle')}
        spec={{
          series: [{ label: 'y[n]', x: range(0, result.y.length), y: result.y, kind: 'stem' }],
          xLabel: t('kitSignals.systems.nAxis'),
          yLabel: 'y[n]',
        }}
      />
      <Results
        rows={[
          [t('kitSignals.systems.poles'), result.poles.map((p) => fmtComplex(p, 5)).join(', ') || '—'],
          [t('kitSignals.systems.zeros'), result.zeros.map((z) => fmtComplex(z, 5)).join(', ') || '—'],
        ]}
      />
      <Plot
        title={t('kitSignals.systems.polesTitle')}
        spec={{
          series: [
            { label: t('kitSignals.systems.zeros'), x: result.zeros.map((z) => z.re), y: result.zeros.map((z) => z.im), kind: 'dots' },
            { label: t('kitSignals.systems.poles'), x: result.poles.map((p) => p.re), y: result.poles.map((p) => p.im), kind: 'dots', tone: 1 },
          ],
          xLabel: t('kitSignals.systems.realAxis'),
          yLabel: t('kitSignals.systems.imagAxis'),
          square: true,
          circle: 1,
        }}
      />
      <StepList steps={result.steps} />
      <InsertMenu
        answer={answer}
        latex={String.raw`\sum_{k} a_k\, y[n-k] = \sum_{k} b_k\, x[n-k]`}
        table={table}
        steps={result.steps}
        picture={() => plot.current?.picture('difference-equation') ?? Promise.resolve(null)}
      />
    </>
  );
}

export function SystemsTool() {
  const [state, set] = useStored('systems', { mode: 'convolution' as Mode });
  return (
    <div className={styles.tool}>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => t(`kitSignals.systems.modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'convolution' ? <ConvolutionMode /> : null}
        {state.mode === 'correlation' ? <CorrelationMode /> : null}
        {state.mode === 'difference' ? <DifferenceMode /> : null}
        {state.mode === 'sampling' ? <SamplingMode /> : null}
        {state.mode === 'quantization' ? <QuantizationMode /> : null}
        {state.mode === 'rate' ? <RateMode /> : null}
        {state.mode === 'continuous' ? <ContinuousMode /> : null}
      </Tabs>
    </div>
  );
}
