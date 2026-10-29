// The sound tool's table tabs: a vowel space from typed formants, an audiogram with the pure-tone average, decibel
// arithmetic with A-weighting, and a tone generator that can play and hand its tone to the analysis tabs.
import { useMemo, useRef } from 'react';
import { Button } from '../../../../ui';
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
  Results,
  StepList,
  TextBox,
  attempt,
  num,
  useStored,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import { CLIP_RATE, play, setClip, toneClip } from './clip';
import {
  aWeighting,
  distanceChange,
  normalizeVowels,
  pureToneAverage,
  subtractLevel,
  sumLevels,
  type Normalization,
} from './engine';
import { w } from './words';

const VOWELS = 'i 280 2250\ne 400 2100\na 750 1300\no 450 850\nu 310 870';

export function VowelMode() {
  const [state, set] = useStored('audio.vowels', { table: VOWELS, how: 'none' as Normalization });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const lines = state.table
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const labels = lines.map((line) => line.split(/\s+/)[0] ?? '');
        const values = lines.map((line) => readNumbers(line.split(/\s+/).slice(1).join(' ')));
        const f1 = values.map((v) => v[0] ?? Number.NaN);
        const f2 = values.map((v) => v[1] ?? Number.NaN);
        return { labels, ...normalizeVowels(f1, f2, state.how) };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <TextBox
          label={w('vowelTable')}
          value={state.table}
          onChange={(table) => set({ table })}
          hint={w('vowelHint')}
          rows={5}
        />
        <Choice
          label={w('normalization')}
          value={state.how}
          options={['none', 'lobanov', 'bark'] as const}
          name={(h) => w(`normalizations.${h}`)}
          onChange={(how) => set({ how })}
        />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('vowelAnswer', { count: outcome.value.labels.length })} />
          <Plot
            ref={plot}
            title={w('vowelTitle')}
            spec={{
              series: outcome.value.labels.map((label, i) => ({
                label,
                x: [outcome.value.x[i]!],
                y: [outcome.value.y[i]!],
                kind: 'dots' as const,
                tone: i % 5,
              })),
              xLabel: w(`axisF2.${state.how}`),
              yLabel: w(`axisF1.${state.how}`),
            }}
          />
          <Note>{w('vowelNote')}</Note>
          <InsertMenu
            answer={w('vowelAnswer', { count: outcome.value.labels.length })}
            table={{
              header: [w('vowel'), 'F1', 'F2'],
              rows: outcome.value.labels.map((label, i) => [
                label,
                fmt(outcome.value.y[i]!, 5),
                fmt(outcome.value.x[i]!, 5),
              ]),
            }}
            picture={() => plot.current?.picture('vowel-space') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

const AUDIOGRAM =
  '250 10 15 5 10\n500 15 20 10 15\n1000 20 25 15 20\n2000 30 35 25 30\n4000 50 55 45 50\n8000 60 65 - -';
const COLUMNS = ['rightAir', 'leftAir', 'rightBone', 'leftBone'] as const;

export function AudiogramMode() {
  const [state, set] = useStored('audio.audiogram', { table: AUDIOGRAM });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const rows = state.table
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .filter((cells) => cells[0]);
        const f = rows.map((cells) => num(cells[0]!));
        const column = (k: number) =>
          rows.map((cells) => (cells[k + 1] && cells[k + 1] !== '-' ? num(cells[k + 1]!) : Number.NaN));
        const byFreq = (k: number) => Object.fromEntries(f.map((freq, i) => [freq, column(k)[i]!]));
        return {
          f,
          columns: COLUMNS.map((_, k) => column(k)),
          right: attempt(() => pureToneAverage(byFreq(0))),
          left: attempt(() => pureToneAverage(byFreq(1))),
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <TextBox
          label={w('audiogramTable')}
          value={state.table}
          onChange={(table) => set({ table })}
          hint={w('audiogramHint')}
          rows={6}
        />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer
            text={w('ptaAnswer', {
              right: outcome.value.right.ok ? fmt(outcome.value.right.value, 4) : '—',
              left: outcome.value.left.ok ? fmt(outcome.value.left.value, 4) : '—',
            })}
          />
          <Plot
            ref={plot}
            title={w('audiogramTitle')}
            spec={{
              series: COLUMNS.map((name, k) => ({
                label: w(`ears.${name}`),
                x: outcome.value.f,
                y: outcome.value.columns[k]!.map((v) => -v),
                kind: k < 2 ? ('line' as const) : ('dots' as const),
                tone: k % 2,
                dashed: k >= 2,
              })),
              xLabel: w('frequencyAxis'),
              yLabel: w('hearingLevel'),
              logX: true,
              yRange: [-120, 10],
            }}
          />
          <Note>{w('audiogramNote')}</Note>
          <InsertMenu
            answer={w('ptaAnswer', {
              right: outcome.value.right.ok ? fmt(outcome.value.right.value, 4) : '—',
              left: outcome.value.left.ok ? fmt(outcome.value.left.value, 4) : '—',
            })}
            picture={() => plot.current?.picture('audiogram') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

export function DecibelMode() {
  const [state, set] = useStored('audio.decibels', { levels: '80, 80', background: '75', r1: '1', r2: '4', f: '100' });
  const outcome = useMemo(
    () =>
      attempt(() => {
        const total = sumLevels(readNumbers(state.levels));
        return {
          total,
          without: attempt(() => subtractLevel(total.level, num(state.background))),
          change: distanceChange(num(state.r1), num(state.r2)),
          weight: aWeighting(num(state.f)),
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <Field label={w('levels')} value={state.levels} onChange={(levels) => set({ levels })} unit="dB" wide />
        <Field
          label={w('background')}
          value={state.background}
          onChange={(background) => set({ background })}
          unit="dB"
        />
        <Field label={w('r1')} value={state.r1} onChange={(r1) => set({ r1 })} unit="m" />
        <Field label={w('r2')} value={state.r2} onChange={(r2) => set({ r2 })} unit="m" />
        <Field label={w('weightAt')} value={state.f} onChange={(f) => set({ f })} unit="Hz" />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('sumAnswer', { level: fmt(outcome.value.total.level, 6) })} />
          <Results
            rows={[
              [
                w('withoutBackground'),
                outcome.value.without.ok ? `${fmt(outcome.value.without.value, 6)} dB` : outcome.value.without.problem,
              ],
              [w('distanceChange'), `${fmt(outcome.value.change, 6)} dB`],
              [w('aWeight'), `${fmt(outcome.value.weight, 4)} dB`],
            ]}
          />
          <StepList steps={outcome.value.total.steps} />
          <Note>{w('weightSource')}</Note>
          <InsertMenu
            answer={w('sumAnswer', { level: fmt(outcome.value.total.level, 6) })}
            latex={String.raw`L = 10\log_{10}\sum_i 10^{L_i/10}`}
            steps={outcome.value.total.steps}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

/** 50 ms from the steady part of a tone, for the waveform picture. */
const shown = (samples: Float32Array): number[] => {
  const start = Math.max(0, Math.min(Math.round(0.3 * CLIP_RATE), samples.length - 800));
  return Array.from(samples.subarray(start, start + 800));
};

const TONE = { f0: '220', harmonics: '8', rolloff: '1', duration: '1', attack: '0.05', release: '0.2' };

export function GeneratorMode() {
  const [state, set] = useStored('audio.generator', TONE);
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() =>
        toneClip({
          f0: num(state.f0),
          harmonics: num(state.harmonics),
          rolloff: num(state.rolloff),
          duration: num(state.duration),
          attack: num(state.attack),
          release: num(state.release),
        }),
      ),
    [state],
  );
  const keys = Object.keys(TONE) as (keyof typeof TONE)[];
  const units: Partial<Record<keyof typeof TONE, string>> = { f0: 'Hz', duration: 's', attack: 's', release: 's' };
  return (
    <>
      <Fields>
        {keys.map((key) => (
          <Field
            key={key}
            label={w(`tone.${key}`)}
            value={state[key]}
            onChange={(value) => set({ [key]: value })}
            {...(units[key] ? { unit: units[key] } : {})}
          />
        ))}
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('toneAnswer', { f0: state.f0, count: state.harmonics })} />
          <div className={styles.actions} role="group" aria-label={w('toneActions')}>
            <Button variant="quiet" onClick={() => play(outcome.value.samples, CLIP_RATE)}>
              {w('playTone')}
            </Button>
            <Button variant="quiet" onClick={() => setClip(outcome.value)}>
              {w('analyzeTone')}
            </Button>
          </div>
          <Plot
            ref={plot}
            title={w('toneTitle')}
            spec={{
              series: [
                {
                  label: w('wave'),
                  x: shown(outcome.value.samples).map((_, i) => i / CLIP_RATE),
                  y: shown(outcome.value.samples),
                  tone: 2,
                },
              ],
              xLabel: w('timeAxis'),
              yLabel: w('amplitude'),
            }}
          />
          <InsertMenu
            answer={w('toneAnswer', { f0: state.f0, count: state.harmonics })}
            picture={() => plot.current?.picture('tone') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}
