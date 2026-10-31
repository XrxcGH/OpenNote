// The spectrum analyzer. Paste samples (or time and value), open a sound, or pick columns of a table on the open
// page; pick a window and a view; and read the spectrum, its peaks, band powers, and the window's corrections, with
// the steps. A second part finds damping from half-power points that are typed in or read from the spectrum.
import { useMemo, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { decodeClip, MAX_SECONDS, type Clip } from '../audio/clip';
import { HEAVY_SIZE, TaskProgress, useTask } from '../shared/useTask';
import { type SpectrumAnalysis } from './analyse';
import { WINDOWS, type WindowName } from '../shared/fft';
import { fmt } from '../shared/num';
import { HeatMap, Plot, type PlotHandle } from '../shared/Plot';
import { exampleSignal, samplesText } from '../shared/signalInput';
import { tableSignal } from '../shared/tableSignal';
import { ColumnPicker, DataField } from '../../subjects/ui/fields';
import { readDataInput, type DataInput, type RoleSpec, type RoleValue } from '../../subjects/ui/input';
import {
  Answer,
  Check,
  Choice,
  DataTable,
  Field,
  Fields,
  InsertMenu,
  Note,
  Problem,
  Results,
  StepList,
  TextBox,
  attempt,
  num,
  useStored,
  type TableData,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import { halfPowerDamping, halfPowerPoints, type Detrend } from './engine';

type View = 'amplitude' | 'power' | 'psd' | 'welch' | 'spectrogram';
const VIEWS: readonly View[] = ['amplitude', 'power', 'psd', 'welch', 'spectrogram'];
const DETRENDS: readonly Detrend[] = ['none', 'mean', 'linear'];

const EXAMPLE = samplesText(
  exampleSignal(
    [
      [10, 1],
      [40, 0.5],
    ],
    256,
    2,
    0.1,
    7,
  ),
);
const BANDS = 'delta 0.5 4\ntheta 4 8\nalpha 8 13\nbeta 13 30\ngamma 30 45';

const FIRST = {
  samples: EXAMPLE,
  rate: '256',
  window: 'hann' as WindowName,
  beta: '8.6',
  detrend: 'mean' as Detrend,
  view: 'amplitude' as View,
  decibels: false,
  logX: false,
  segment: '128',
  overlap: '50',
  bands: BANDS,
  f1: '9.8',
  f2: '10.2',
  fn: '10',
  /** A table read from the open page (or pasted into the data field), and which columns are the value and time. */
  table: { text: '', table: null } as DataInput,
  columns: {} as RoleValue,
};
type State = typeof FIRST;

const TABLE_ROLES: readonly RoleSpec[] = [
  { role: 'response', kinds: ['number'] },
  { role: 'time', kinds: ['number', 'date'], optional: true },
];

type Analysis = SpectrumAnalysis;

/** Open a sound file to analyze instead of the pasted samples, decoded to one 16 kHz channel. */
function SoundSource({ sound, setSound }: { sound: Clip | null; setSound(sound: Clip | null): void }) {
  const [problem, setProblem] = useState('');
  const load = async (file: File) => {
    try {
      const clip = await decodeClip(await file.arrayBuffer(), file.name);
      setSound({ ...clip, samples: clip.samples.slice(0, MAX_SECONDS * clip.rate) });
      setProblem('');
    } catch {
      setProblem(t('kitSignals.spectrum.soundProblem'));
    }
  };
  return (
    <>
      <div className={styles.actions}>
        <label className={styles.field}>
          <span>{t('kitSignals.spectrum.soundFile')}</span>
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.ogg"
            onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])}
          />
        </label>
        {sound ? (
          <Button variant="quiet" onClick={() => setSound(null)}>
            {t('kitSignals.spectrum.usePasted')}
          </Button>
        ) : null}
      </div>
      {sound ? (
        <Note>
          {t('kitSignals.spectrum.soundNote', {
            name: sound.name,
            seconds: fmt(sound.samples.length / sound.rate, 3),
            rate: fmt(sound.rate),
          })}
        </Note>
      ) : null}
      {problem ? <Problem text={problem} /> : null}
    </>
  );
}

/** A table on the open page as the source: the value column, and a time column that sets the rate. */
function TableSource({ state, set }: { state: State; set(patch: Partial<State>): void }) {
  const data = useMemo(() => readDataInput(state.table), [state.table]);
  const active = Boolean(state.table.text.trim() && typeof state.columns.response === 'string');
  return (
    <>
      <DataField
        label={t('kitSignals.spectrum.pageTable')}
        value={state.table}
        onChange={(table) => set({ table })}
        data={data}
      />
      {data.columns.length ? (
        <ColumnPicker data={data} roles={TABLE_ROLES} value={state.columns} onChange={(columns) => set({ columns })} />
      ) : null}
      {active ? (
        <div className={styles.actions}>
          <Note>{t('kitSignals.spectrum.tableNote', { column: String(state.columns.response) })}</Note>
          <Button variant="quiet" onClick={() => set({ columns: {} })}>
            {t('kitSignals.spectrum.usePasted')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function SignalFields({ state, set }: { state: State; set(patch: Partial<State>): void }) {
  return (
    <Fields>
      <TextBox
        label={t('kitSignals.spectrum.samples')}
        hint={t('kitSignals.spectrum.samplesHint')}
        value={state.samples}
        onChange={(samples) => set({ samples })}
        rows={5}
      />
      <Field label={t('kitSignals.spectrum.rate')} value={state.rate} onChange={(rate) => set({ rate })} unit="Hz" />
      <Choice
        label={t('kitSignals.spectrum.window')}
        value={state.window}
        options={WINDOWS}
        name={(w) => t(`kitSignals.spectrum.windows.${w}`)}
        onChange={(window) => set({ window })}
      />
      {state.window === 'kaiser' ? (
        <Field label={t('kitSignals.spectrum.beta')} value={state.beta} onChange={(beta) => set({ beta })} />
      ) : null}
      <Choice
        label={t('kitSignals.spectrum.detrend')}
        value={state.detrend}
        options={DETRENDS}
        name={(d) => t(`kitSignals.spectrum.detrends.${d}`)}
        onChange={(detrend) => set({ detrend })}
      />
      <Choice
        label={t('kitSignals.spectrum.view')}
        value={state.view}
        options={VIEWS}
        name={(v) => t(`kitSignals.spectrum.views.${v}`)}
        onChange={(view) => set({ view })}
      />
      {state.view === 'welch' || state.view === 'spectrogram' ? (
        <>
          <Field
            label={t('kitSignals.spectrum.segment')}
            value={state.segment}
            onChange={(segment) => set({ segment })}
          />
          <Field
            label={t('kitSignals.spectrum.overlap')}
            value={state.overlap}
            onChange={(overlap) => set({ overlap })}
            unit="%"
          />
        </>
      ) : null}
      <Check
        label={t('kitSignals.spectrum.decibels')}
        checked={state.decibels}
        onChange={(decibels) => set({ decibels })}
      />
      <Check label={t('kitSignals.spectrum.logFrequency')} checked={state.logX} onChange={(logX) => set({ logX })} />
    </Fields>
  );
}

function axisName(view: View): string {
  if (view === 'amplitude') return t('kitSignals.spectrum.amplitudeAxis');
  if (view === 'power') return t('kitSignals.spectrum.powerAxis');
  return t('kitSignals.spectrum.psdAxis');
}

function SpectrumView({ state, result }: { state: State; result: Analysis }) {
  const plot = useRef<PlotHandle>(null);
  const view = state.view;
  const db = (v: number) => (view === 'amplitude' ? 20 : 10) * Math.log10(Math.max(v, 1e-30));
  const y = state.decibels ? result.shown.map(db) : result.shown;
  const name = axisName(view);
  const title = t('kitSignals.spectrum.plotTitle', { view: t(`kitSignals.spectrum.views.${view}`) });
  const start = state.logX ? 1 : 0;
  const peakTable: TableData = {
    header: [t('kitSignals.spectrum.peakFrequency'), t('kitSignals.spectrum.peakValue')],
    rows: result.found.map((p) => [fmt(p.freq), fmt(p.value)]),
  };
  const top = result.found[0];
  const answer = top
    ? t('kitSignals.spectrum.answer', { value: fmt(top.value), freq: fmt(top.freq) })
    : t('kitSignals.spectrum.noPeak');
  const w = result.whole;
  return (
    <>
      {result.signal.rate ? <Note>{t('kitSignals.spectrum.rateFromTimes', { rate: fmt(result.rate) })}</Note> : null}
      <Answer text={answer} />
      {result.heat ? (
        <HeatMap
          ref={plot}
          title={t('kitSignals.spectrum.spectrogramTitle')}
          spec={{
            values: result.heat.rows,
            xRange: [result.heat.times[0] ?? 0, result.heat.times[result.heat.times.length - 1] ?? 1],
            yRange: [0, result.heat.maxFreq],
            xLabel: t('kitSignals.spectrum.time'),
            yLabel: t('kitSignals.spectrum.frequency'),
          }}
        />
      ) : (
        <Plot
          ref={plot}
          title={title}
          spec={{
            series: [{ label: name, x: result.freq.subarray(start), y: y.subarray(start) }],
            xLabel: t('kitSignals.spectrum.frequency'),
            yLabel: state.decibels ? t('kitSignals.spectrum.dbAxis', { name }) : name,
            logX: state.logX,
            markers: result.found.slice(0, 3).map((p) => ({ x: p.freq, label: `${fmt(p.freq, 4)} Hz` })),
          }}
        />
      )}
      <Results
        rows={[
          [t('kitSignals.spectrum.record'), `N = ${w.n}, fs = ${fmt(result.rate)} Hz`],
          [t('kitSignals.spectrum.binWidth'), `${fmt(w.binWidth)} Hz`],
          [t('kitSignals.spectrum.coherentGain'), fmt(w.coherentGain)],
          [
            t('kitSignals.spectrum.enbw'),
            t('kitSignals.spectrum.enbwValue', { bins: fmt(w.enbw), hz: fmt(w.enbw * w.binWidth) }),
          ],
          [
            t('kitSignals.spectrum.parseval'),
            t('kitSignals.spectrum.parsevalValue', {
              time: fmt(w.parseval.time),
              frequency: fmt(w.parseval.frequency),
            }),
          ],
          ...(result.averaged ? [[t('kitSignals.spectrum.segments'), String(result.averaged.segments)] as const] : []),
        ]}
      />
      <DataTable caption={t('kitSignals.spectrum.peaksTitle')} table={peakTable} />
      <Note>{t('kitSignals.spectrum.leakage')}</Note>
      <StepList steps={result.steps} />
      <InsertMenu
        answer={answer}
        latex={String.raw`A_k = \frac{2\,|X_k|}{N\,\mathrm{CG}},\quad \mathrm{PSD}_k = \frac{2\,|X_k|^2}{f_s \sum w_n^2}`}
        table={peakTable}
        steps={result.steps}
        picture={() => plot.current?.picture('spectrum') ?? Promise.resolve(null)}
      />
    </>
  );
}

function BandTable({ result }: { result: Analysis }) {
  const table: TableData = {
    header: [
      t('kitSignals.spectrum.bandHeader'),
      t('kitSignals.spectrum.rangeHeader'),
      t('kitSignals.spectrum.powerHeader'),
      t('kitSignals.spectrum.relativeHeader'),
    ],
    rows: result.bands.map((b) => [
      b.band.name,
      `${fmt(b.band.low)}–${fmt(b.band.high)}`,
      fmt(b.power),
      `${fmt(b.relative * 100, 4)}%`,
    ]),
  };
  return (
    <>
      <DataTable caption={t('kitSignals.spectrum.bands')} table={table} />
      <InsertMenu table={table} />
    </>
  );
}

function Damping({ state, set, result }: { state: State; set(patch: Partial<State>): void; result: Analysis | null }) {
  const outcome = attempt(() => halfPowerDamping(num(state.f1), num(state.f2), num(state.fn)));
  const read = () => {
    if (!result) return;
    const points = attempt(() => halfPowerPoints(result.whole.freq, result.whole.amplitude));
    if (points.ok) set({ f1: fmt(points.value[0], 8), f2: fmt(points.value[1], 8), fn: fmt(points.value[2], 8) });
  };
  const answer = outcome.ok
    ? t('kitSignals.spectrum.dampingAnswer', { zeta: fmt(outcome.value.zeta), q: fmt(outcome.value.q) })
    : '';
  return (
    <section className={styles.panel} aria-label={t('kitSignals.spectrum.damping')}>
      <h3 className={styles.heading}>{t('kitSignals.spectrum.damping')}</h3>
      <Fields>
        <Field label={t('kitSignals.spectrum.f1')} value={state.f1} onChange={(f1) => set({ f1 })} unit="Hz" />
        <Field label={t('kitSignals.spectrum.f2')} value={state.f2} onChange={(f2) => set({ f2 })} unit="Hz" />
        <Field label={t('kitSignals.spectrum.fn')} value={state.fn} onChange={(fn) => set({ fn })} unit="Hz" />
      </Fields>
      <div className={styles.actions}>
        <Button variant="quiet" disabled={!result} onClick={read}>
          {t('kitSignals.spectrum.fromSpectrum')}
        </Button>
      </div>
      {outcome.ok ? (
        <>
          <Answer text={answer} />
          <StepList steps={outcome.value.steps} />
          <InsertMenu answer={answer} latex={String.raw`\zeta = \frac{f_2 - f_1}{2 f_n}`} steps={outcome.value.steps} />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </section>
  );
}

export function SpectrumTool() {
  const [state, set] = useStored('spectrum', FIRST);
  const [sound, setSound] = useState<Clip | null>(null);
  const table = useMemo(() => attempt(() => tableSignal(state.table, state.columns)), [state.table, state.columns]);
  const run = useTask(
    'spectrum',
    useMemo(
      () => ({
        settings: state,
        sound: sound ? { samples: sound.samples, rate: sound.rate } : null,
        table: table.ok ? table.value : null,
      }),
      [state, sound, table],
    ),
    (sound?.samples.length ?? 0) > HEAVY_SIZE,
  );
  const { progress, cancel } = run;
  // A table that cannot be read says so, unless a sound stands in for it.
  const outcome = !table.ok && !sound ? table : run.outcome;
  return (
    <div className={styles.tool}>
      <SoundSource sound={sound} setSound={setSound} />
      <TableSource state={state} set={set} />
      <SignalFields state={state} set={set} />
      <div className={styles.actions}>
        <Button
          variant="quiet"
          onClick={() => {
            setSound(null);
            set({ samples: EXAMPLE, rate: '256', bands: BANDS, columns: {} });
          }}
        >
          {t('kitSignals.ui.useExample')}
        </Button>
      </div>
      <TaskProgress progress={progress} cancel={cancel} />
      {outcome === null ? null : outcome.ok ? (
        <>
          <SpectrumView state={state} result={outcome.value} />
          <BandTable result={outcome.value} />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
      <Damping state={state} set={set} result={outcome?.ok ? outcome.value : null} />
    </div>
  );
}
