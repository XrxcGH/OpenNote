// Neural and physiological time series: one tab per kind of record. Event-related averages, fMRI designs with fits,
// spike trains, ECG heart-rate variability, and a 10-20 dot map. Each tab starts from a seeded example.
import { useMemo, useRef, type RefObject } from 'react';
import { t } from '../../../../strings/t';
import { fmt, gaussian, readNumbers, readRows, seededRandom } from '../shared/num';
import { Plot, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Field,
  Fields,
  InsertMenu,
  Note,
  Problem,
  Results,
  StepList,
  Tabs,
  TextBox,
  attempt,
  num,
  say,
  useStored,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import {
  ELECTRODES,
  correlations,
  epochAverage,
  glm,
  hrf,
  hrv,
  kernelRate,
  lombScargle,
  peakIn,
  rPeaks,
  regressor,
  spikeStats,
} from './engine';

type Mode = 'erp' | 'fmri' | 'spikes' | 'ecg' | 'topo';
const MODES: readonly Mode[] = ['erp', 'fmri', 'spikes', 'ecg', 'topo'];
const w = (key: string, vars?: Record<string, string | number>) => say(`kitSignals.neurodata.${key}`, vars);
const list = (v: readonly number[], digits = 4) => v.map((x) => x.toFixed(digits)).join(' ');

/** Seeded examples, so each tab shows a result at once. */
const EXAMPLE = (() => {
  const normal = gaussian(seededRandom(3));
  const events = Array.from({ length: 40 }, (_, k) => 60 + k * 70);
  const eeg = Array.from({ length: 2900 }, () => normal());
  for (const e of events)
    for (let i = 0; i < 40; i += 1) eeg[e + i]! += 3 * Math.sin((Math.PI * i) / 40) * (i > 20 ? 1 : 0.5);
  const ecgFs = 250;
  const beat = Math.round(0.8 * ecgFs);
  const ecg = Array.from({ length: ecgFs * 20 }, (_, i) => {
    const jitter = Math.round(6 * Math.sin(Math.floor(i / beat)));
    const k = (i % beat) - jitter;
    return Math.exp(-(((k - 30) / 3) ** 2)) + 0.05 * normal();
  });
  const spikes = Array.from({ length: 6 }, (_, trial) => {
    const random = seededRandom(20 + trial);
    const times: number[] = [];
    for (let s = 0; s < 1; s += 0.004)
      if (random() < (s > 0.3 && s < 0.6 ? 0.2 : 0.04)) times.push(Number(s.toFixed(3)));
    return times.join(' ');
  }).join('\n');
  return { eeg: list(eeg, 3), events: events.join(' '), ecg: list(ecg, 3), spikes };
})();

function ErpPlot(props: {
  avg: ReturnType<typeof epochAverage>;
  peak: ReturnType<typeof peakIn>;
  chart: RefObject<PlotHandle | null>;
}) {
  const { avg, peak, chart } = props;
  return (
    <Plot
      ref={chart}
      title={w('erpTitle')}
      spec={{
        series: [
          { label: w('average'), x: avg.t, y: avg.average },
          {
            label: w('plusSe'),
            x: avg.t,
            y: avg.average.map((v, i) => v + avg.se[i]!),
            tone: 4,
            dashed: true,
          },
          {
            label: w('minusSe'),
            x: avg.t,
            y: avg.average.map((v, i) => v - avg.se[i]!),
            tone: 4,
            dashed: true,
          },
        ],
        xLabel: w('timeAxis'),
        yLabel: w('amplitude'),
        markers: [{ x: peak.latency, label: w('peak') }],
      }}
    />
  );
}

function ErpMode() {
  const [state, set] = useStored('neurodata.erp', {
    data: EXAMPLE.eeg,
    events: EXAMPLE.events,
    fs: '100',
    pre: '0.1',
    post: '0.5',
    reject: '100',
    from: '0.2',
    to: '0.4',
  });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const avg = epochAverage(
          readNumbers(state.data),
          num(state.fs),
          readNumbers(state.events),
          num(state.pre),
          num(state.post),
          num(state.reject),
        );
        return { avg, peak: peakIn(avg.t, avg.average, num(state.from), num(state.to), 'positive') };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <TextBox label={w('samples')} value={state.data} onChange={(data) => set({ data })} rows={3} />
        <Field
          label={w('events')}
          value={state.events}
          onChange={(events) => set({ events })}
          hint={w('eventsHint')}
          wide
        />
        {(['fs', 'pre', 'post', 'reject', 'from', 'to'] as const).map((key) => (
          <Field
            key={key}
            label={w(`erpFields.${key}`)}
            value={state[key]}
            onChange={(value) => set({ [key]: value })}
          />
        ))}
      </Fields>
      {outcome.ok ? (
        <>
          <Answer
            text={w('erpAnswer', {
              n: outcome.value.avg.kept.length,
              rejected: outcome.value.avg.rejected,
              amp: fmt(outcome.value.peak.amplitude, 4),
              lat: fmt(outcome.value.peak.latency * 1000, 4),
            })}
          />
          <ErpPlot avg={outcome.value.avg} peak={outcome.value.peak} chart={plot} />
          <Results
            rows={[
              [w('meanAmplitude'), fmt(outcome.value.peak.meanAmplitude, 4)],
              [w('snrGain'), fmt(Math.sqrt(outcome.value.avg.kept.length), 4)],
            ]}
          />
          <Note>{w('erpNote')}</Note>
          <InsertMenu
            answer={w('erpAnswer', {
              n: outcome.value.avg.kept.length,
              rejected: outcome.value.avg.rejected,
              amp: fmt(outcome.value.peak.amplitude, 4),
              lat: fmt(outcome.value.peak.latency * 1000, 4),
            })}
            picture={() => plot.current?.picture('erp') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function fmriFit(state: {
  onsets: string;
  durations: string;
  onsetsB: string;
  tr: string;
  scans: string;
  data: string;
}) {
  const tr = num(state.tr);
  const scans = num(state.scans);
  const a = regressor(readNumbers(state.onsets), readNumbers(state.durations), tr, scans);
  const b = state.onsetsB.trim()
    ? regressor(readNumbers(state.onsetsB), readNumbers(state.durations), tr, scans)
    : null;
  const normal = gaussian(seededRandom(9));
  const y = state.data.trim() ? readNumbers(state.data) : a.map((v) => 100 + 2 * v + 0.3 * normal());
  const columns = [a, ...(b ? [b] : []), Array<number>(scans).fill(1)];
  const fit = glm(
    columns,
    y,
    columns.map((_, i) => (i === 0 ? 1 : 0)),
  );
  return { a, b, y, fit, r: b ? correlations([a, b])[0]![1]! : null, tr };
}

function FmriMode() {
  const [state, set] = useStored('neurodata.fmri', {
    onsets: '10 50 90 130',
    durations: '20',
    onsetsB: '',
    tr: '2',
    scans: '90',
    data: '',
  });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(() => attempt(() => fmriFit(state)), [state]);
  const hrfT = Array.from({ length: 321 }, (_, i) => i * 0.1);
  return (
    <>
      <Fields>
        {(['onsets', 'durations', 'onsetsB', 'tr', 'scans'] as const).map((key) => (
          <Field
            key={key}
            label={w(`fmriFields.${key}`)}
            value={state[key]}
            onChange={(value) => set({ [key]: value })}
          />
        ))}
        <TextBox
          label={w('fmriFields.data')}
          value={state.data}
          onChange={(data) => set({ data })}
          hint={w('fmriDataHint')}
          rows={2}
        />
      </Fields>
      <Plot
        title={w('hrfTitle')}
        spec={{
          series: [{ label: w('hrf'), x: hrfT, y: hrfT.map(hrf) }],
          xLabel: w('timeAxis'),
          yLabel: w('response'),
        }}
      />
      {outcome.ok ? (
        <>
          <Answer
            text={w('fmriAnswer', {
              beta: fmt(outcome.value.fit.beta[0]!, 4),
              t: fmt(outcome.value.fit.t, 4),
              df: outcome.value.fit.df,
            })}
          />
          <Plot
            ref={plot}
            title={w('fitTitle')}
            spec={{
              series: [
                {
                  label: w('voxel'),
                  x: outcome.value.y.map((_, i) => i * outcome.value.tr),
                  y: outcome.value.y,
                  kind: 'dots',
                  tone: 4,
                },
                {
                  label: w('fitted'),
                  x: outcome.value.y.map((_, i) => i * outcome.value.tr),
                  y: outcome.value.fit.fitted,
                  tone: 1,
                },
              ],
              xLabel: w('timeAxis'),
              yLabel: w('signal'),
            }}
          />
          {outcome.value.r !== null ? <Results rows={[[w('collinearity'), fmt(outcome.value.r, 4)]]} /> : null}
          <StepList steps={outcome.value.fit.steps} />
          <Note>{w('hrfNote')}</Note>
          <InsertMenu
            answer={w('fmriAnswer', {
              beta: fmt(outcome.value.fit.beta[0]!, 4),
              t: fmt(outcome.value.fit.t, 4),
              df: outcome.value.fit.df,
            })}
            steps={outcome.value.fit.steps}
            latex={String.raw`\hat\beta = (X^\top X)^{-1}X^\top y`}
            picture={() => plot.current?.picture('glm-fit') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function SpikesMode() {
  const [state, set] = useStored('neurodata.spikes', {
    trials: EXAMPLE.spikes,
    window: '1',
    bin: '0.05',
    sigma: '0.03',
  });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const trials = readRows(state.trials);
        return {
          trials,
          stats: spikeStats(trials, num(state.window), num(state.bin)),
          smooth: kernelRate(trials, num(state.window), num(state.sigma)),
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <TextBox
          label={w('trials')}
          value={state.trials}
          onChange={(trials) => set({ trials })}
          hint={w('trialsHint')}
          rows={4}
        />
        {(['window', 'bin', 'sigma'] as const).map((key) => (
          <Field
            key={key}
            label={w(`spikeFields.${key}`)}
            value={state[key]}
            onChange={(value) => set({ [key]: value })}
            unit="s"
          />
        ))}
      </Fields>
      {outcome.ok ? (
        <>
          <Answer
            text={w('spikesAnswer', {
              rate: fmt(outcome.value.stats.rate, 4),
              cv: fmt(outcome.value.stats.cv, 4),
              fano: fmt(outcome.value.stats.fano, 4),
            })}
          />
          <Plot
            title={w('rasterTitle')}
            spec={{
              series: [
                {
                  label: w('spikes'),
                  x: outcome.value.trials.flat(),
                  y: outcome.value.trials.flatMap((tr, i) => tr.map(() => i + 1)),
                  kind: 'dots',
                },
              ],
              xLabel: w('timeAxis'),
              yLabel: w('trial'),
            }}
          />
          <Plot
            ref={plot}
            title={w('psthTitle')}
            spec={{
              series: [
                {
                  label: w('psth'),
                  x: outcome.value.stats.centers,
                  y: outcome.value.stats.psth,
                  kind: 'steps',
                  tone: 2,
                },
                { label: w('kernelRate'), x: outcome.value.smooth.t, y: outcome.value.smooth.rate, tone: 1 },
              ],
              xLabel: w('timeAxis'),
              yLabel: w('rateAxis'),
            }}
          />
          <StepList steps={outcome.value.stats.steps} />
          <InsertMenu
            answer={w('spikesAnswer', {
              rate: fmt(outcome.value.stats.rate, 4),
              cv: fmt(outcome.value.stats.cv, 4),
              fano: fmt(outcome.value.stats.fano, 4),
            })}
            steps={outcome.value.stats.steps}
            picture={() => plot.current?.picture('psth') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function EcgMode() {
  const [state, set] = useStored('neurodata.ecg', { data: EXAMPLE.ecg, fs: '250' });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const x = readNumbers(state.data);
        const fs = num(state.fs);
        const peaks = rPeaks(x, fs);
        const rr = peaks.slice(1).map((p, i) => ((p - peaks[i]!) / fs) * 1000);
        const stats = hrv(rr);
        const times = peaks.slice(1).map((p) => p / fs);
        return { x, fs, peaks, stats, spectrum: lombScargle(times, rr) };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <TextBox label={w('ecgSamples')} value={state.data} onChange={(data) => set({ data })} rows={3} />
        <Field label={w('erpFields.fs')} value={state.fs} onChange={(fs) => set({ fs })} unit="Hz" />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer
            text={w('ecgAnswer', {
              hr: fmt(outcome.value.stats.hr, 4),
              sdnn: fmt(outcome.value.stats.sdnn, 4),
              rmssd: fmt(outcome.value.stats.rmssd, 4),
            })}
          />
          <Plot
            ref={plot}
            title={w('ecgTitle')}
            spec={{
              series: [
                {
                  label: w('ecg'),
                  x: outcome.value.x.map((_, i) => i / outcome.value.fs),
                  y: outcome.value.x,
                  tone: 4,
                },
                {
                  label: w('rPeaks'),
                  x: outcome.value.peaks.map((p) => p / outcome.value.fs),
                  y: outcome.value.peaks.map((p) => outcome.value.x[p]!),
                  kind: 'dots',
                  tone: 1,
                },
              ],
              xLabel: w('timeAxis'),
              yLabel: w('amplitude'),
            }}
          />
          <Results
            rows={[
              ['pNN50', `${fmt(outcome.value.stats.pnn50, 4)}%`],
              [w('lfHf'), fmt(outcome.value.spectrum.lf / outcome.value.spectrum.hf, 4)],
            ]}
          />
          <StepList steps={outcome.value.stats.steps} />
          <Note>{w('ecgNote')}</Note>
          <InsertMenu
            answer={w('ecgAnswer', {
              hr: fmt(outcome.value.stats.hr, 4),
              sdnn: fmt(outcome.value.stats.sdnn, 4),
              rmssd: fmt(outcome.value.stats.rmssd, 4),
            })}
            steps={outcome.value.stats.steps}
            picture={() => plot.current?.picture('ecg') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

const TOPO = 'Fz 2.1\nCz 3.4\nPz 4.2\nC3 2.8\nC4 2.9\nF3 1.5\nF4 1.6\nP3 3.6\nP4 3.7\nO1 2.0\nO2 2.1';

function TopoMode() {
  const [state, set] = useStored('neurodata.topo', { values: TOPO });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const rows = state.values
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .filter((cells) => cells.length >= 2);
        const known = rows
          .filter(([name]) => name! in ELECTRODES)
          .map(([name, v]) => ({ name: name!, value: num(v!) }));
        if (!known.length) throw new RangeError('no electrodes');
        const values = known.map((k) => k.value).sort((a, b) => a - b);
        const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => values[Math.floor(q * (values.length - 1))]!);
        const bin = (v: number) => cuts.filter((c) => v > c).length;
        return { known, bin, cuts, low: values[0]!, high: values.at(-1)!, unknown: rows.length - known.length };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <TextBox
          label={w('topoValues')}
          value={state.values}
          onChange={(values) => set({ values })}
          hint={w('topoHint')}
          rows={5}
        />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer
            text={w('topoAnswer', {
              count: outcome.value.known.length,
              low: fmt(outcome.value.low, 4),
              high: fmt(outcome.value.high, 4),
            })}
          />
          <Plot
            ref={plot}
            title={w('topoTitle')}
            spec={{
              series: [0, 1, 2, 3, 4].map((b) => {
                const inBin = outcome.value.known.filter((k) => outcome.value.bin(k.value) === b);
                return {
                  label: w('topoBin', { n: b + 1 }),
                  x: inBin.map((k) => ELECTRODES[k.name]![0]),
                  y: inBin.map((k) => ELECTRODES[k.name]![1]),
                  kind: 'dots' as const,
                  tone: b,
                };
              }),
              xLabel: w('leftRight'),
              yLabel: w('backFront'),
              square: true,
              circle: 1,
              xRange: [-1.1, 1.1],
              yRange: [-1.1, 1.1],
            }}
          />
          <Note>{w('topoNote')}</Note>
          <InsertMenu
            answer={w('topoAnswer', {
              count: outcome.value.known.length,
              low: fmt(outcome.value.low, 4),
              high: fmt(outcome.value.high, 4),
            })}
            picture={() => plot.current?.picture('electrode-map') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={w('topoProblem')} />
      )}
    </>
  );
}

export function NeuroTool() {
  const [state, set] = useStored('neurodata', { mode: 'erp' as Mode });
  return (
    <div className={styles.tool}>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => w(`modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'erp' ? <ErpMode /> : null}
        {state.mode === 'fmri' ? <FmriMode /> : null}
        {state.mode === 'spikes' ? <SpikesMode /> : null}
        {state.mode === 'ecg' ? <EcgMode /> : null}
        {state.mode === 'topo' ? <TopoMode /> : null}
      </Tabs>
    </div>
  );
}
