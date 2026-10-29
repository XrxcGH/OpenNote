// Sound analysis and acoustics: one tab per task. Analyze shows the clip's waveform, spectrogram, pitch, intensity,
// and formants with a time cursor and labels; the tuner and tone practice read the same clip. The vowel space,
// audiogram, decibel, and generator tabs are in AudioModes.tsx.
import { useMemo, useRef, useState, type RefObject } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { fmt } from '../shared/num';
import { HeatMap, Plot, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Choice,
  DataTable,
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
  useStored,
  type TableData,
} from '../shared/ui';
import { SignalError } from '../shared/errors';
import styles from '../shared/kit.module.css';
import { spectrogram, type Spectrogram } from '../spectrum/engine';
import { decodeClip, setClip, startRecording, useClip, type Clip } from './clip';
import {
  chaoContour,
  formants,
  jitterShimmer,
  pitchTrack,
  rmsDifference,
  speakerContour,
  tuner,
  type Formant,
  type PitchTrack,
} from './engine';
import { AudiogramMode, DecibelMode, GeneratorMode, VowelMode } from './AudioModes';
import { w } from './words';

type Mode = 'analyze' | 'tuner' | 'tones' | 'vowels' | 'audiogram' | 'decibels' | 'generator';
const MODES: readonly Mode[] = ['analyze', 'tuner', 'tones', 'vowels', 'audiogram', 'decibels', 'generator'];

/** Load a file or record from the microphone; either replaces the shared clip. */
function ClipSource() {
  const clip = useClip();
  const [recording, setRecording] = useState<{ stop(): Promise<Clip> } | null>(null);
  const [problem, setProblem] = useState('');
  const load = async (file: File) => {
    try {
      setClip(await decodeClip(await file.arrayBuffer(), file.name));
      setProblem('');
    } catch {
      setProblem(w('decodeProblem'));
    }
  };
  const toggle = async () => {
    try {
      if (recording) {
        setRecording(null);
        setClip(await recording.stop());
      } else setRecording(await startRecording());
      setProblem('');
    } catch {
      setRecording(null);
      setProblem(w('micProblem'));
    }
  };
  return (
    <>
      <div className={styles.actions} role="group" aria-label={w('sourceGroup')}>
        <label className={styles.field}>
          <span>{w('loadFile')}</span>
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.ogg"
            onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])}
          />
        </label>
        <Button variant="quiet" onClick={() => void toggle()}>
          {w(recording ? 'stopRecording' : 'record')}
        </Button>
      </div>
      <Note>
        {w('clipNote', {
          name: clip.name === 'example' ? w('exampleName') : clip.name,
          seconds: fmt(clip.samples.length / clip.rate, 3),
        })}
      </Note>
      {problem ? <Problem text={problem} /> : null}
    </>
  );
}

const ANALYZE = {
  from: '0',
  to: '1',
  preset: 'wide' as 'wide' | 'narrow',
  cursor: '0.5',
  labels: '0.1 0.4 a\n0.5 0.9 a',
};

function analyze(clip: Clip, state: typeof ANALYZE) {
  const rate = clip.rate;
  const from = Math.max(0, Math.round(num(state.from) * rate) || 0);
  const to = Math.min(clip.samples.length, Math.round(num(state.to) * rate) || clip.samples.length);
  const x = Array.from(clip.samples.subarray(from, to));
  const track = pitchTrack(x, rate);
  const segment = rate * (state.preset === 'wide' ? 0.005 : 0.03);
  const heat = spectrogram({
    samples: x,
    rate,
    window: 'hann',
    detrend: 'mean',
    segment: 2 ** Math.round(Math.log2(segment)),
    overlap: 0.5,
  });
  const at = Math.round((num(state.cursor) - from / rate) * rate);
  const half = Math.round(0.0125 * rate);
  const centre = Math.min(Math.max(half, at), x.length - half);
  const found = formants(x.slice(centre - half, centre + half), rate);
  const frame = track.times.findIndex((time) => time >= centre / rate);
  return {
    x,
    from: from / rate,
    track,
    heat,
    found,
    frame: Math.max(0, frame),
    voice: attempt(() => jitterShimmer(track)),
  };
}

function AnalyzeMode() {
  const clip = useClip();
  const [state, set] = useStored('audio.analyze', ANALYZE);
  const pitch = useRef<PlotHandle>(null);
  const outcome = useMemo(() => attempt(() => analyze(clip, state)), [clip, state]);
  const fields = (
    <Fields>
      <Field label={w('from')} value={state.from} onChange={(from) => set({ from })} unit="s" />
      <Field label={w('to')} value={state.to} onChange={(to) => set({ to })} unit="s" />
      <Choice
        label={w('preset')}
        value={state.preset}
        options={['wide', 'narrow'] as const}
        name={(p) => w(`presets.${p}`)}
        onChange={(preset) => set({ preset })}
      />
      <Field label={w('cursor')} value={state.cursor} onChange={(cursor) => set({ cursor })} unit="s" />
    </Fields>
  );
  if (!outcome.ok)
    return (
      <>
        <ClipSource />
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const { x, from, track, heat, found, frame, voice } = outcome.value;
  const times = track.times.map((time) => time + from);
  const f0 = track.f0[frame];
  const answer = w('analyzeAnswer', {
    f0: Number.isFinite(f0) ? fmt(f0!, 5) : '—',
    f1: found[0] ? fmt(found[0].frequency, 4) : '—',
    f2: found[1] ? fmt(found[1].frequency, 4) : '—',
    f3: found[2] ? fmt(found[2].frequency, 4) : '—',
  });
  const table: TableData = {
    header: [w('time'), 'f0 (Hz)', w('intensity')],
    rows: times.map((time, i) => [
      fmt(time, 4),
      Number.isFinite(track.f0[i]) ? fmt(track.f0[i]!, 5) : '—',
      fmt(track.db[i]!, 4),
    ]),
  };
  const labels = labelTable(state.labels, times, track.f0);
  const step = Math.max(1, Math.floor(x.length / 2000));
  const wave = x.filter((_, i) => i % step === 0);
  return (
    <>
      <ClipSource />
      {fields}
      <Answer text={answer} />
      <Results rows={voiceRows(found, voice)} />
      <SoundPictures wave={wave} step={step} from={from} rate={clip.rate} heat={heat} cursor={num(state.cursor)} />
      <TrackPlots times={times} track={track} cursor={num(state.cursor)} chart={pitch} />
      <TextBox
        label={w('labels')}
        value={state.labels}
        onChange={(text) => set({ labels: text })}
        hint={w('labelsHint')}
        rows={3}
      />
      {labels.ok ? <DataTable caption={w('labelsTable')} table={labels.value} /> : <Problem text={labels.problem} />}
      <DataTable caption={w('measurements')} table={table} limit={40} />
      <Note>{w('methodNote')}</Note>
      <InsertMenu
        answer={answer}
        table={labels.ok ? labels.value : table}
        picture={() => pitch.current?.picture('pitch-track') ?? Promise.resolve(null)}
      />
    </>
  );
}

/** The formants at the cursor and the voice measures, as result rows. */
function voiceRows(
  found: Formant[],
  voice: ReturnType<typeof attempt<ReturnType<typeof jitterShimmer>>>,
): [string, string][] {
  return [
    [
      w('formantTable'),
      found
        .slice(0, 3)
        .map((f) => `${fmt(f.frequency, 4)} Hz (${fmt(f.bandwidth, 3)} Hz)`)
        .join(', ') || '—',
    ],
    ...(voice.ok
      ? ([
          [w('jitter'), `${fmt(voice.value.jitter, 3)}%`],
          [w('shimmer'), `${fmt(voice.value.shimmer, 3)}%`],
        ] as [string, string][])
      : []),
  ];
}

function SoundPictures(props: {
  wave: number[];
  step: number;
  from: number;
  rate: number;
  heat: Spectrogram;
  cursor: number;
}) {
  const { wave, step, from, rate, heat, cursor } = props;
  return (
    <>
      <Plot
        title={w('waveTitle')}
        spec={{
          series: [{ label: w('wave'), x: wave.map((_, i) => from + (i * step) / rate), y: wave, tone: 4 }],
          xLabel: w('timeAxis'),
          yLabel: w('amplitude'),
          markers: [{ x: cursor, label: '▲' }],
        }}
      />
      <HeatMap
        title={w('spectrogramTitle')}
        spec={{
          values: heat.rows,
          xRange: [from + (heat.times[0] ?? 0), from + (heat.times.at(-1) ?? 1)],
          yRange: [0, heat.maxFreq],
          xLabel: w('timeAxis'),
          yLabel: w('frequencyAxis'),
        }}
      />
    </>
  );
}

function TrackPlots(props: {
  times: number[];
  track: PitchTrack;
  cursor: number;
  chart: RefObject<PlotHandle | null>;
}) {
  const { times, track, cursor, chart } = props;
  return (
    <>
      <Plot
        ref={chart}
        title={w('pitchTitle')}
        spec={{
          series: [{ label: 'f0', x: times, y: track.f0, kind: 'dots', tone: 1 }],
          xLabel: w('timeAxis'),
          yLabel: w('hertz'),
          markers: [{ x: cursor, label: '▲' }],
        }}
      />
      <Plot
        title={w('intensityTitle')}
        spec={{
          series: [{ label: w('intensity'), x: times, y: track.db, tone: 2 }],
          xLabel: w('timeAxis'),
          yLabel: 'dB',
        }}
      />
    </>
  );
}

/** An interval tier: each line is a start, an end, and a label; the table adds the duration and the mean f0. */
function labelTable(text: string, times: number[], f0: number[]) {
  return attempt(() => {
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [a, b, ...rest] = line.split(/\s+/);
        const start = num(a ?? '');
        const end = num(b ?? '');
        if (!(end > start)) throw new SignalError('labelLine', { text: line });
        const inside = f0.filter((f, i) => times[i]! >= start && times[i]! <= end && Number.isFinite(f));
        const mean = inside.length ? inside.reduce((s, f) => s + f, 0) / inside.length : Number.NaN;
        return [rest.join(' '), fmt(start, 4), fmt(end, 4), fmt((end - start) * 1000, 4), fmt(mean, 5)];
      });
    return { header: [w('label'), w('start'), w('end'), w('durationMs'), w('meanF0')], rows } as TableData;
  });
}

function TunerMode() {
  const clip = useClip();
  const [state, set] = useStored('audio.tuner', { f: '445', a4: '440', source: 'typed' as 'typed' | 'clip' });
  const outcome = useMemo(
    () =>
      attempt(() => {
        const a4 = num(state.a4);
        if (state.source === 'typed') return { reading: tuner(num(state.f), a4), range: null };
        const voiced = pitchTrack(Array.from(clip.samples), clip.rate)
          .f0.filter(Number.isFinite)
          .sort((p, q) => p - q);
        if (!voiced.length) return { reading: tuner(Number.NaN, a4), range: null };
        const median = voiced[Math.floor(voiced.length / 2)]!;
        return { reading: tuner(median, a4), range: [tuner(voiced[0]!, a4), tuner(voiced.at(-1)!, a4)] as const };
      }),
    [state, clip],
  );
  return (
    <>
      <Fields>
        <Choice
          label={w('tunerSource')}
          value={state.source}
          options={['typed', 'clip'] as const}
          name={(s) => w(`tunerSources.${s}`)}
          onChange={(source) => set({ source })}
        />
        {state.source === 'typed' ? (
          <Field label={w('frequency')} value={state.f} onChange={(f) => set({ f })} unit="Hz" />
        ) : null}
        <Field label={w('a4')} value={state.a4} onChange={(a4) => set({ a4 })} unit="Hz" />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer
            text={w('tunerAnswer', {
              note: outcome.value.reading.note,
              cents: `${outcome.value.reading.cents >= 0 ? '+' : '−'}${fmt(Math.abs(outcome.value.reading.cents), 5)}`,
            })}
          />
          {outcome.value.range ? (
            <Results rows={[[w('range'), `${outcome.value.range[0].note} – ${outcome.value.range[1].note}`]]} />
          ) : null}
          <StepList steps={outcome.value.reading.steps} />
          <InsertMenu
            answer={w('tunerAnswer', { note: outcome.value.reading.note, cents: fmt(outcome.value.reading.cents, 5) })}
            steps={outcome.value.reading.steps}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function TonesMode() {
  const clip = useClip();
  const [state, set] = useStored('audio.tones', { target: '35' });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const target = chaoContour(state.target);
        const speaker = speakerContour(pitchTrack(Array.from(clip.samples), clip.rate).f0);
        return { target, speaker, rms: rmsDifference(speaker, target) };
      }),
    [state, clip],
  );
  const grid = Array.from({ length: 50 }, (_, i) => i / 49);
  return (
    <>
      <ClipSource />
      <Fields>
        <Field label={w('chao')} value={state.target} onChange={(target) => set({ target })} hint={w('chaoHint')} />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('tonesAnswer', { rms: fmt(outcome.value.rms, 3) })} />
          <Plot
            ref={plot}
            title={w('tonesTitle')}
            spec={{
              series: [
                { label: w('targetContour'), x: grid, y: outcome.value.target, tone: 3, dashed: true },
                { label: w('yourContour'), x: grid, y: outcome.value.speaker, tone: 1 },
              ],
              xLabel: w('normalizedTime'),
              yLabel: w('semitones'),
              yRange: [-8, 8],
            }}
          />
          <Note>{w('chaoNote')}</Note>
          <InsertMenu
            answer={w('tonesAnswer', { rms: fmt(outcome.value.rms, 3) })}
            picture={() => plot.current?.picture('tone-contour') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

export function AudioTool() {
  const [state, set] = useStored('audio', { mode: 'analyze' as Mode });
  return (
    <div className={styles.tool}>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => w(`modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'analyze' ? <AnalyzeMode /> : null}
        {state.mode === 'tuner' ? <TunerMode /> : null}
        {state.mode === 'tones' ? <TonesMode /> : null}
        {state.mode === 'vowels' ? <VowelMode /> : null}
        {state.mode === 'audiogram' ? <AudiogramMode /> : null}
        {state.mode === 'decibels' ? <DecibelMode /> : null}
        {state.mode === 'generator' ? <GeneratorMode /> : null}
      </Tabs>
    </div>
  );
}
