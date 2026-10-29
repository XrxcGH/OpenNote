// The sampling side of the discrete-systems tool: aliasing with zero-order-hold and sinc reconstructions, a
// quantized sine with its noise ratio, upsampling and downsampling with their spectra, and continuous convolution.
import { useMemo, useRef } from 'react';
import { t } from '../../../../strings/t';
import { fft } from '../shared/fft';
import { fmt, readNumbers } from '../shared/num';
import { Plot, type PlotHandle } from '../shared/Plot';
import {
  Answer,
  Check,
  Choice,
  Field,
  Fields,
  InsertMenu,
  Note,
  Problem,
  Results,
  StepList,
  attempt,
  num,
  useStored,
} from '../shared/ui';
import { aliased, changeRate, convolveContinuous, pieceAt, quantize, sampleAndRebuild, type PieceKind } from './engine';

export function SamplingMode() {
  const [state, set] = useStored('systems.sampling', { f: '7000', fs: '10000', duration: '0.002' });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const f = num(state.f);
        const fs = num(state.fs);
        return { alias: aliased(f, fs), rebuilt: sampleAndRebuild(f, fs, num(state.duration)) };
      }),
    [state],
  );
  const fields = (
    <Fields>
      <Field label={t('kitSignals.systems.toneFrequency')} value={state.f} onChange={(f) => set({ f })} unit="Hz" />
      <Field label={t('kitSignals.systems.sampleRate')} value={state.fs} onChange={(fs) => set({ fs })} unit="Hz" />
      <Field
        label={t('kitSignals.systems.duration')}
        value={state.duration}
        onChange={(duration) => set({ duration })}
        unit="s"
      />
    </Fields>
  );
  if (!outcome.ok)
    return (
      <>
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const { alias, rebuilt } = outcome.value;
  const answer = t('kitSignals.systems.aliasAnswer', { f: state.f, fs: state.fs, fa: fmt(alias.apparent) });
  return (
    <>
      {fields}
      <Answer text={answer} />
      <Note>{t(alias.aliases ? 'kitSignals.systems.aliasYes' : 'kitSignals.systems.aliasNo')}</Note>
      <Plot
        ref={plot}
        title={t('kitSignals.systems.samplingTitle')}
        spec={{
          series: [
            { label: t('kitSignals.systems.original'), x: rebuilt.grid, y: rebuilt.original, tone: 0 },
            { label: t('kitSignals.systems.hold'), x: rebuilt.grid, y: rebuilt.hold, kind: 'steps', tone: 3 },
            { label: t('kitSignals.systems.sinc'), x: rebuilt.grid, y: rebuilt.sinc, tone: 2, dashed: true },
            { label: t('kitSignals.systems.samples'), x: rebuilt.times, y: rebuilt.samples, kind: 'dots', tone: 1 },
          ],
          xLabel: t('kitSignals.systems.timeAxis'),
          yLabel: t('kitSignals.systems.valueAxis'),
        }}
      />
      <Results
        rows={[
          [t('kitSignals.systems.apparent'), `${fmt(alias.apparent)} Hz`],
          [t('kitSignals.systems.nyquist'), `${fmt(alias.nyquist)} Hz`],
        ]}
      />
      <StepList steps={alias.steps} />
      <InsertMenu
        answer={answer}
        latex={String.raw`f_a = \left| f - f_s \,\mathrm{round}(f / f_s) \right|`}
        steps={alias.steps}
        picture={() => plot.current?.picture('sampling') ?? Promise.resolve(null)}
      />
    </>
  );
}

export function QuantizationMode() {
  const [state, set] = useStored('systems.quantization', { bits: '4', fullScale: '1', dither: false });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () => attempt(() => quantize(Math.round(num(state.bits)), num(state.fullScale), 3, 4096, state.dither)),
    [state],
  );
  const fields = (
    <Fields>
      <Field label={t('kitSignals.systems.bits')} value={state.bits} onChange={(bits) => set({ bits })} />
      <Field
        label={t('kitSignals.systems.fullScale')}
        value={state.fullScale}
        onChange={(fullScale) => set({ fullScale })}
      />
      <Check label={t('kitSignals.systems.dither')} checked={state.dither} onChange={(dither) => set({ dither })} />
    </Fields>
  );
  if (!outcome.ok)
    return (
      <>
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const result = outcome.value;
  const shown = Array.from({ length: 1366 }, (_, n) => n);
  const answer = t('kitSignals.systems.quantAnswer', {
    theory: fmt(result.theory, 5),
    bits: state.bits,
    measured: fmt(result.measured, 4),
  });
  return (
    <>
      {fields}
      <Answer text={answer} />
      <Plot
        ref={plot}
        title={t('kitSignals.systems.quantTitle')}
        spec={{
          series: [
            { label: t('kitSignals.systems.original'), x: shown, y: result.input.slice(0, shown.length) },
            {
              label: t('kitSignals.systems.quantized'),
              x: shown,
              y: result.output.slice(0, shown.length),
              kind: 'steps',
              tone: 1,
            },
          ],
          xLabel: t('kitSignals.systems.nAxis'),
          yLabel: t('kitSignals.systems.valueAxis'),
        }}
      />
      <Results
        rows={[
          [t('kitSignals.systems.stepSize'), fmt(result.stepSize)],
          [t('kitSignals.systems.levels'), String(result.levels)],
          [t('kitSignals.systems.theory'), `${fmt(result.theory, 5)} dB`],
          [t('kitSignals.systems.measured'), `${fmt(result.measured, 4)} dB`],
        ]}
      />
      <StepList steps={result.steps} />
      <InsertMenu
        answer={answer}
        latex={String.raw`\mathrm{SQNR} = 6.02\,N + 1.76\ \mathrm{dB}`}
        steps={result.steps}
        picture={() => plot.current?.picture('quantization') ?? Promise.resolve(null)}
      />
    </>
  );
}

/** Magnitudes of the DFT over 0 to 0.5 cycles per sample, zero-padded to a smooth curve. */
function magnitudes(x: readonly number[]): { f: number[]; m: number[] } {
  const n = Math.max(256, 2 ** Math.ceil(Math.log2(x.length * 4)));
  const X = fft([...x, ...Array<number>(n - x.length).fill(0)]);
  const f: number[] = [];
  const m: number[] = [];
  for (let k = 0; k <= n / 2; k += 1) {
    f.push(k / n);
    m.push(Math.hypot(X.re[k]!, X.im[k]!));
  }
  return { f, m };
}

const EXAMPLE_RATE = Array.from({ length: 24 }, (_, n) => Number(Math.cos(2 * Math.PI * 0.1 * n).toFixed(4))).join(
  ', ',
);

export function RateMode() {
  const [state, set] = useStored('systems.rate', { x: EXAMPLE_RATE, up: '2', down: '1' });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => ({ x: readNumbers(state.x), ...changeRate(readNumbers(state.x), num(state.up), num(state.down)) })),
    [state],
  );
  const fields = (
    <Fields>
      <Field label={t('kitSignals.systems.x')} value={state.x} onChange={(x) => set({ x })} wide />
      <Field label={t('kitSignals.systems.up')} value={state.up} onChange={(up) => set({ up })} />
      <Field label={t('kitSignals.systems.down')} value={state.down} onChange={(down) => set({ down })} />
    </Fields>
  );
  if (!outcome.ok)
    return (
      <>
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const { x, y, steps } = outcome.value;
  const before = magnitudes(x);
  const after = magnitudes(y);
  const answer = t('kitSignals.systems.rateAnswer', { inCount: x.length, outCount: y.length });
  return (
    <>
      {fields}
      <Answer text={answer} />
      <Plot
        title={t('kitSignals.systems.outputTitle')}
        spec={{
          series: [{ label: 'y[n]', x: y.map((_, n) => n), y, kind: 'stem' }],
          xLabel: t('kitSignals.systems.nAxis'),
          yLabel: t('kitSignals.systems.valueAxis'),
        }}
      />
      <Plot
        ref={plot}
        title={t('kitSignals.systems.rateSpectrum')}
        spec={{
          series: [
            { label: t('kitSignals.systems.before'), x: before.f, y: before.m },
            { label: t('kitSignals.systems.after'), x: after.f, y: after.m, tone: 1, dashed: true },
          ],
          xLabel: t('kitSignals.systems.binAxis'),
          yLabel: t('kitSignals.systems.magnitudeAxis'),
        }}
      />
      <StepList steps={steps} />
      <InsertMenu
        answer={answer}
        steps={steps}
        picture={() => plot.current?.picture('rate-change') ?? Promise.resolve(null)}
      />
    </>
  );
}

const KINDS: readonly PieceKind[] = ['rect', 'triangle', 'exponential', 'step'];
const PIECE = { kind: 'rect' as PieceKind, at: '0', size: '1', height: '1' };

function PieceFields({
  which,
  piece,
  onPiece,
}: {
  which: 'f' | 'g';
  piece: typeof PIECE;
  onPiece(next: typeof PIECE): void;
}) {
  return (
    <Fields>
      <Choice
        label={`${t(`kitSignals.systems.${which}`)}: ${t('kitSignals.systems.kind')}`}
        value={piece.kind}
        options={KINDS}
        name={(kind) => t(`kitSignals.systems.kinds.${kind}`)}
        onChange={(kind) => onPiece({ ...piece, kind })}
      />
      <Field
        label={t('kitSignals.systems.at')}
        value={piece.at}
        onChange={(at) => onPiece({ ...piece, at })}
        unit="s"
      />
      <Field label={t('kitSignals.systems.size')} value={piece.size} onChange={(size) => onPiece({ ...piece, size })} />
      <Field
        label={t('kitSignals.systems.height')}
        value={piece.height}
        onChange={(height) => onPiece({ ...piece, height })}
      />
    </Fields>
  );
}

const toPiece = (p: typeof PIECE) => ({ kind: p.kind, at: num(p.at), size: num(p.size), height: num(p.height) });

export function ContinuousMode() {
  const [state, set] = useStored('systems.continuous', { f: PIECE, g: { ...PIECE, kind: 'exponential' as PieceKind } });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(() => attempt(() => convolveContinuous(toPiece(state.f), toPiece(state.g))), [state]);
  const fields = (
    <>
      <PieceFields which="f" piece={state.f} onPiece={(f) => set({ f })} />
      <PieceFields which="g" piece={state.g} onPiece={(g) => set({ g })} />
    </>
  );
  if (!outcome.ok)
    return (
      <>
        {fields}
        <Problem text={outcome.problem} />
      </>
    );
  const result = outcome.value;
  const top = result.y.indexOf(Math.max(...result.y));
  const answer = t('kitSignals.systems.continuousAnswer', { peak: fmt(result.y[top]!, 4), at: fmt(result.t[top]!, 4) });
  const f = toPiece(state.f);
  const g = toPiece(state.g);
  return (
    <>
      {fields}
      <Answer text={answer} />
      <Plot
        ref={plot}
        title={t('kitSignals.systems.continuousTitle')}
        spec={{
          series: [
            { label: 'f(t)', x: result.t, y: result.t.map((time) => pieceAt(f, time)), dashed: true },
            { label: 'g(t)', x: result.t, y: result.t.map((time) => pieceAt(g, time)), tone: 1, dashed: true },
            { label: '(f ∗ g)(t)', x: result.t, y: result.y, tone: 2 },
          ],
          xLabel: t('kitSignals.systems.timeAxis'),
          yLabel: t('kitSignals.systems.valueAxis'),
        }}
      />
      <StepList steps={result.steps} />
      <InsertMenu
        answer={answer}
        latex={String.raw`(f * g)(t) = \int_{-\infty}^{\infty} f(\tau)\, g(t-\tau)\, d\tau`}
        steps={result.steps}
        picture={() => plot.current?.picture('continuous-convolution') ?? Promise.resolve(null)}
      />
    </>
  );
}
