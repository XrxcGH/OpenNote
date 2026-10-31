// The digital filter designer: FIR by the window method, IIR from analog prototypes, simple filters (moving average
// and notch), and a tab that applies a designed filter to data. It runs once (causal) or both ways (zero phase).
import { useMemo, useRef } from 'react';
import { t } from '../../../../strings/t';
import { WINDOWS } from '../shared/fft';
import { fmt, readNumbers } from '../shared/num';
import { Plot, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Choice,
  Field,
  Fields,
  InsertMenu,
  Note,
  Problem,
  Tabs,
  TextBox,
  attempt,
  num,
  useStored,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import { filtfilt, lfilter, medianFilter } from './apply';
import { BANDS, FIR_KINDS, PROTOTYPES } from './design';
import { FIR, FilterView, IIR, SIMPLE, designFir, designIir, designSimple, w } from './FilterView';

type Mode = 'fir' | 'iir' | 'simple' | 'apply';
const MODES: readonly Mode[] = ['iir', 'fir', 'simple', 'apply'];
const banded = (kind: string) => kind === 'bandpass' || kind === 'bandstop';

function FirMode() {
  const [state, set] = useStored('filters.fir', FIR);
  const outcome = useMemo(() => attempt(() => designFir(state)), [state]);
  return (
    <>
      <Fields>
        <Choice
          label={w('kind')}
          value={state.kind}
          options={FIR_KINDS}
          name={(k) => w(`kinds.${k}`)}
          onChange={(kind) => set({ kind })}
        />
        <Field label={w('fs')} value={state.fs} onChange={(fs) => set({ fs })} unit="Hz" />
        {state.kind !== 'differentiator' && state.kind !== 'hilbert' ? (
          <Field
            label={w(banded(state.kind) ? 'f1' : 'cutoff')}
            value={state.f1}
            onChange={(f1) => set({ f1 })}
            unit="Hz"
          />
        ) : null}
        {banded(state.kind) ? (
          <Field label={w('f2')} value={state.f2} onChange={(f2) => set({ f2 })} unit="Hz" />
        ) : null}
        <Choice
          label={w('sizing')}
          value={state.sizing}
          options={['taps', 'kaiser'] as const}
          name={(s) => w(`sizings.${s}`)}
          onChange={(sizing) => set({ sizing })}
        />
        {state.sizing === 'taps' ? (
          <>
            <Choice
              label={w('window')}
              value={state.window}
              options={WINDOWS}
              name={(v) => t(`kitSignals.spectrum.windows.${v}`)}
              onChange={(window) => set({ window })}
            />
            <Field label={w('taps')} value={state.taps} onChange={(taps) => set({ taps })} />
            {state.window === 'kaiser' ? (
              <Field label={w('beta')} value={state.beta} onChange={(beta) => set({ beta })} />
            ) : null}
          </>
        ) : (
          <>
            <Field
              label={w('attenuation')}
              value={state.attenuation}
              onChange={(attenuation) => set({ attenuation })}
              unit="dB"
            />
            <Field label={w('width')} value={state.width} onChange={(width) => set({ width })} hint={w('widthHint')} />
          </>
        )}
      </Fields>
      {outcome.ok ? (
        <FilterView
          filter={outcome.value.filter}
          fs={num(state.fs)}
          answer={w('firAnswer', { taps: outcome.value.taps, delay: fmt((outcome.value.taps - 1) / 2) })}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function IirMode() {
  const [state, set] = useStored('filters.iir', IIR);
  const outcome = useMemo(() => attempt(() => designIir(state)), [state]);
  return (
    <>
      <Fields>
        <Choice
          label={w('prototype')}
          value={state.type}
          options={PROTOTYPES}
          name={(p) => w(`prototypes.${p}`)}
          onChange={(type) => set({ type })}
        />
        <Choice
          label={w('method')}
          value={state.method}
          options={['bilinear', 'impulse'] as const}
          name={(m) => w(`methods.${m}`)}
          onChange={(method) => set({ method })}
        />
        {state.method === 'bilinear' ? (
          <Choice
            label={w('kind')}
            value={state.band}
            options={BANDS}
            name={(k) => w(`kinds.${k}`)}
            onChange={(band) => set({ band })}
          />
        ) : null}
        <Field label={w('order')} value={state.order} onChange={(order) => set({ order })} />
        <Field label={w('fs')} value={state.fs} onChange={(fs) => set({ fs })} unit="Hz" />
        <Field
          label={w(banded(state.band) && state.method === 'bilinear' ? 'f1' : 'cutoff')}
          value={state.f1}
          onChange={(f1) => set({ f1 })}
          unit="Hz"
        />
        {banded(state.band) && state.method === 'bilinear' ? (
          <Field label={w('f2')} value={state.f2} onChange={(f2) => set({ f2 })} unit="Hz" />
        ) : null}
        {state.type === 'chebyshev1' || state.type === 'elliptic' ? (
          <Field label={w('ripple')} value={state.ripple} onChange={(ripple) => set({ ripple })} unit="dB" />
        ) : null}
        {state.type === 'chebyshev2' || state.type === 'elliptic' ? (
          <Field label={w('stop')} value={state.stop} onChange={(stop) => set({ stop })} unit="dB" />
        ) : null}
      </Fields>
      {state.method === 'impulse' ? <Note>{w('impulseNote')}</Note> : null}
      {outcome.ok ? (
        <FilterView
          filter={outcome.value}
          fs={num(state.fs)}
          answer={w('iirAnswer', { order: state.order, sections: outcome.value.sos?.length ?? 0 })}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function SimpleMode() {
  const [state, set] = useStored('filters.simple', SIMPLE);
  const outcome = useMemo(() => attempt(() => designSimple(state)), [state]);
  return (
    <>
      <Fields>
        <Choice
          label={w('kind')}
          value={state.kind}
          options={['notch', 'average'] as const}
          name={(k) => w(`simple.${k}`)}
          onChange={(kind) => set({ kind })}
        />
        <Field label={w('fs')} value={state.fs} onChange={(fs) => set({ fs })} unit="Hz" />
        {state.kind === 'average' ? (
          <Field label={w('points')} value={state.points} onChange={(points) => set({ points })} />
        ) : (
          <>
            <Field
              label={w('notchAt')}
              value={state.f0}
              onChange={(f0) => set({ f0 })}
              unit="Hz"
              hint={w('notchHint')}
            />
            <Field label={w('notchWidth')} value={state.width} onChange={(width) => set({ width })} unit="Hz" />
          </>
        )}
      </Fields>
      {outcome.ok ? (
        <FilterView
          filter={outcome.value}
          fs={num(state.fs)}
          answer={w(state.kind === 'average' ? 'averageAnswer' : 'notchAnswer', { f0: state.f0, m: state.points })}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

const SAMPLE = Array.from({ length: 400 }, (_, n) => {
  const t0 = n / 1000;
  return Math.sin(2 * Math.PI * 5 * t0) + 0.4 * Math.sin(2 * Math.PI * 60 * t0) + (n === 200 ? 3 : 0);
})
  .map((v) => v.toFixed(4))
  .join('\n');

function ApplyMode() {
  const [state, set] = useStored('filters.apply', {
    source: 'simple' as 'fir' | 'iir' | 'simple' | 'median',
    direction: 'zeroPhase' as 'causal' | 'zeroPhase',
    data: SAMPLE,
    median: '5',
  });
  const [fir] = useStored('filters.fir', FIR);
  const [iir] = useStored('filters.iir', IIR);
  const [simple] = useStored('filters.simple', SIMPLE);
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const x = readNumbers(state.data);
        if (state.source === 'median') return { x, y: medianFilter(x, num(state.median)) };
        const filter =
          state.source === 'fir'
            ? designFir(fir).filter
            : state.source === 'iir'
              ? designIir(iir)
              : designSimple(simple);
        return {
          x,
          y: state.direction === 'causal' ? lfilter(filter.b, filter.a, x) : filtfilt(filter.b, filter.a, x),
        };
      }),
    [state, fir, iir, simple],
  );
  const index = outcome.ok ? outcome.value.x.map((_, n) => n) : [];
  return (
    <>
      <Fields>
        <Choice
          label={w('source')}
          value={state.source}
          options={['fir', 'iir', 'simple', 'median'] as const}
          name={(s) => w(`sources.${s}`)}
          onChange={(source) => set({ source })}
        />
        {state.source === 'median' ? (
          <Field label={w('medianWindow')} value={state.median} onChange={(median) => set({ median })} />
        ) : (
          <Choice
            label={w('direction')}
            value={state.direction}
            options={['zeroPhase', 'causal'] as const}
            name={(d) => w(`directions.${d}`)}
            onChange={(direction) => set({ direction })}
          />
        )}
        <TextBox
          label={w('data')}
          value={state.data}
          onChange={(data) => set({ data })}
          hint={w('dataHint')}
          rows={4}
        />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('applyAnswer', { count: outcome.value.y.length })} />
          <Plot
            ref={plot}
            title={w('applyTitle')}
            spec={{
              series: [
                { label: w('input'), x: index, y: outcome.value.x, tone: 4 },
                { label: w('output'), x: index, y: outcome.value.y, tone: 1 },
              ],
              xLabel: 'n',
              yLabel: w('value'),
            }}
          />
          <InsertMenu
            answer={w('applyAnswer', { count: outcome.value.y.length })}
            table={{
              header: ['n', 'x[n]', 'y[n]'],
              rows: outcome.value.y.slice(0, 500).map((v, n) => [String(n), fmt(outcome.value.x[n]!), fmt(v)]),
            }}
            picture={() => plot.current?.picture('filtered') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

export function FiltersTool() {
  const [state, set] = useStored('filters', { mode: 'iir' as Mode });
  return (
    <div className={styles.tool}>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => w(`modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'fir' ? <FirMode /> : null}
        {state.mode === 'iir' ? <IirMode /> : null}
        {state.mode === 'simple' ? <SimpleMode /> : null}
        {state.mode === 'apply' ? <ApplyMode /> : null}
      </Tabs>
    </div>
  );
}
