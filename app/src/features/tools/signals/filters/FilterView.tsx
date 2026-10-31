// What every filter design shows. Plots: magnitude (dB or linear), unwrapped phase, group delay, the impulse response,
// the step response, and the poles and zeros. Tables: the coefficients. It also draws the response again with the
// coefficients rounded to fixed point. The design tabs' form states live here, so the apply tab can rebuild a design.
import { useRef, type RefObject } from 'react';
import { fmt, fmtComplex } from '../shared/num';
import { Plot, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Choice,
  DataTable,
  Field,
  Fields,
  InsertMenu,
  Results,
  StepList,
  num,
  say,
  useStored,
  type TableData,
} from '../shared/ui';
import type { WindowName } from '../shared/fft';
import { SignalError } from '../shared/errors';
import { frequencyResponse, impulseAndStep, polesZeros } from './apply';
import {
  firWindow,
  iirBilinear,
  iirImpulseInvariant,
  kaiserEstimate,
  movingAverage,
  notch,
  quantizeCoefficients,
  type Band,
  type Filter,
  type FirKind,
  type Prototype,
} from './design';

/** The words of this tool, by their key under kitSignals.filters. */
export const w = (key: string, vars?: Record<string, string | number>) => say(`kitSignals.filters.${key}`, vars);

export const FIR = {
  kind: 'lowpass' as FirKind,
  fs: '8000',
  f1: '1000',
  f2: '2000',
  window: 'hamming' as WindowName,
  taps: '21',
  beta: '5',
  sizing: 'taps' as 'taps' | 'kaiser',
  attenuation: '60',
  width: '0.05',
};
export const IIR = {
  type: 'butterworth' as Prototype,
  band: 'lowpass' as Band,
  method: 'bilinear' as 'bilinear' | 'impulse',
  order: '2',
  fs: '8000',
  f1: '1000',
  f2: '2000',
  ripple: '1',
  stop: '40',
};
export const SIMPLE = { kind: 'notch' as 'average' | 'notch', fs: '1000', points: '5', f0: '60', width: '4' };

export function designFir(state: typeof FIR): { filter: Filter; taps: number; beta: number } {
  let taps = num(state.taps);
  let beta = num(state.beta);
  const extra = [];
  if (state.sizing === 'kaiser') {
    const estimate = kaiserEstimate(num(state.attenuation), num(state.width));
    taps =
      estimate.taps + (estimate.taps % 2 === 0 && (state.kind === 'highpass' || state.kind === 'bandstop') ? 1 : 0);
    beta = estimate.beta;
    extra.push(...estimate.steps);
  }
  const window = state.sizing === 'kaiser' ? 'kaiser' : state.window;
  const filter = firWindow(state.kind, taps, num(state.f1), num(state.f2), num(state.fs), window, beta);
  return { filter: { ...filter, steps: [...extra, ...filter.steps] }, taps, beta };
}

export function designIir(state: typeof IIR): Filter {
  const order = num(state.order);
  if (state.method === 'impulse') {
    if (state.type === 'chebyshev2' || state.type === 'elliptic') throw new SignalError('impulseAllPole');
    return iirImpulseInvariant(state.type, order, num(state.f1), num(state.fs), num(state.ripple));
  }
  return iirBilinear(
    state.type,
    state.band,
    order,
    num(state.f1),
    num(state.f2),
    num(state.fs),
    num(state.ripple),
    num(state.stop),
  );
}

export const designSimple = (state: typeof SIMPLE): Filter =>
  state.kind === 'average' ? movingAverage(num(state.points)) : notch(num(state.f0), num(state.width), num(state.fs));

const coefficientTable = (filter: Filter): TableData => {
  const n = Math.max(filter.b.length, filter.a.length);
  return {
    header: ['k', 'b[k]', 'a[k]'],
    rows: Array.from({ length: Math.min(n, 256) }, (_, k) => [
      String(k),
      k < filter.b.length ? fmt(filter.b[k]!, 9) : '',
      k < filter.a.length ? fmt(filter.a[k]!, 9) : '',
    ]),
  };
};

interface PlotsInput {
  filter: Filter;
  fs: number;
  bits: number;
  scale: 'db' | 'linear';
  chart: RefObject<PlotHandle | null>;
}

function ResponsePlots({ filter, fs, bits, scale, chart }: PlotsInput) {
  const r = frequencyResponse(filter.b, filter.a, fs);
  const q =
    Number.isInteger(bits) && bits >= 2 && bits <= 32
      ? frequencyResponse(quantizeCoefficients(filter.b, bits).values, quantizeCoefficients(filter.a, bits).values, fs)
      : null;
  const pick = (one: typeof r) => (scale === 'db' ? one.db : one.magnitude);
  const time = impulseAndStep(filter.b, filter.a, Math.min(256, Math.max(32, filter.b.length + 16)));
  const pz = polesZeros(filter.b, filter.a);
  const index = time.impulse.map((_, n) => n);
  return (
    <>
      <Plot
        ref={chart}
        title={w('magnitudeTitle')}
        spec={{
          series: [
            { label: w('designed'), x: r.f, y: pick(r) },
            ...(q ? [{ label: w('quantized', { bits }), x: q.f, y: pick(q), tone: 1, dashed: true }] : []),
          ],
          xLabel: w('frequencyAxis'),
          yLabel: scale === 'db' ? w('gainDb') : w('gainLinear'),
          ...(scale === 'db'
            ? { yRange: [Math.max(-120, Math.min(...r.db.filter(Number.isFinite))), 5] as [number, number] }
            : {}),
        }}
      />
      <Plot
        title={w('phaseTitle')}
        spec={{
          series: [{ label: w('phase'), x: r.f, y: r.phase, tone: 2 }],
          xLabel: w('frequencyAxis'),
          yLabel: w('degrees'),
        }}
      />
      <Plot
        title={w('delayTitle')}
        spec={{
          series: [{ label: w('delay'), x: r.f, y: r.delay, tone: 3 }],
          xLabel: w('frequencyAxis'),
          yLabel: w('samples'),
        }}
      />
      <Plot
        title={w('timeTitle')}
        spec={{
          series: [
            { label: w('impulse'), x: index, y: time.impulse, kind: 'stem' },
            { label: w('step'), x: index, y: time.step, kind: 'steps', tone: 1 },
          ],
          xLabel: 'n',
          yLabel: w('value'),
        }}
      />
      <Plot
        title={w('poleZeroTitle')}
        spec={{
          series: [
            { label: w('zeros'), x: pz.zeros.map((z) => z.re), y: pz.zeros.map((z) => z.im), kind: 'dots' },
            { label: w('poles'), x: pz.poles.map((p) => p.re), y: pz.poles.map((p) => p.im), kind: 'dots', tone: 1 },
          ],
          xLabel: w('real'),
          yLabel: w('imaginary'),
          square: true,
          circle: 1,
        }}
      />
    </>
  );
}

/** The full view of a designed filter. */
export function FilterView({ filter, fs, answer }: { filter: Filter; fs: number; answer: string }) {
  const [view, set] = useStored('filters.view', { scale: 'db' as 'db' | 'linear', bits: '16' });
  const magnitude = useRef<PlotHandle>(null);
  const pz = polesZeros(filter.b, filter.a);
  const stable = pz.poles.every((p) => Math.hypot(p.re, p.im) < 1);
  const table = coefficientTable(filter);
  return (
    <>
      <Answer text={answer} />
      <Fields>
        <Choice
          label={w('scale')}
          value={view.scale}
          options={['db', 'linear'] as const}
          name={(s) => w(`scales.${s}`)}
          onChange={(scale) => set({ scale })}
        />
        <Field label={w('bits')} value={view.bits} onChange={(bits) => set({ bits })} hint={w('bitsHint')} />
      </Fields>
      <Results
        rows={[
          [w('stability'), w(stable ? 'stable' : 'unstable')],
          [
            w('poles'),
            pz.poles
              .slice(0, 6)
              .map((p) => fmtComplex(p, 4))
              .join(', ') || '—',
          ],
        ]}
      />
      <ResponsePlots filter={filter} fs={fs} bits={num(view.bits)} scale={view.scale} chart={magnitude} />
      {filter.sos ? (
        <DataTable
          caption={w('sosTitle')}
          table={{ header: ['b0', 'b1', 'b2', 'a0', 'a1', 'a2'], rows: filter.sos.map((s) => s.map((v) => fmt(v, 7))) }}
        />
      ) : null}
      <DataTable caption={w('coefficients')} table={table} />
      <StepList steps={filter.steps} />
      <InsertMenu
        answer={answer}
        latex={String.raw`H(z) = \frac{\sum_k b_k z^{-k}}{\sum_k a_k z^{-k}}`}
        table={table}
        steps={filter.steps}
        picture={() => magnitude.current?.picture('filter-response') ?? Promise.resolve(null)}
      />
    </>
  );
}
