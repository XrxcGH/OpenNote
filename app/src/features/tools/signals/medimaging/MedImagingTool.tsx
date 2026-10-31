// Medical imaging physics: one tab per modality. MRI signal equations with contrast curves, a Bloch simulator, a
// k-space demonstration, CT numbers and windows, ultrasound, X-ray attenuation, and PET uptake.
import { useMemo, useRef } from 'react';
import { t } from '../../../../strings/t';
import { fmt } from '../shared/num';
import { HeatMap, Plot, type PlotHandle } from '../shared/Plot';
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
  Tabs,
  attempt,
  num,
  say,
  useStored,
} from '../shared/ui';
import type { Step } from '../shared/steps';
import styles from '../shared/kit.module.css';
import {
  GAMMA_PROTON_MHZ_PER_T,
  beerLambert,
  bloch,
  doppler,
  hounsfield,
  inverseSquare,
  kSpace,
  larmor,
  mriSignal,
  suv,
  tofPosition,
  ultrasound,
  windowLevel,
  type KMask,
  type Sequence,
} from './engine';

type Mode = 'mri' | 'bloch' | 'kspace' | 'ct' | 'ultrasound' | 'xray' | 'pet';
const MODES: readonly Mode[] = ['mri', 'bloch', 'kspace', 'ct', 'ultrasound', 'xray', 'pet'];
const w = (key: string, vars?: Record<string, string | number>) => say(`kitSignals.medimaging.${key}`, vars);

/** A tab's fields from a list of [key, unit] pairs, labeled from the strings. */
function NumberFields<S extends Record<string, string>>({
  state,
  set,
  keys,
}: {
  state: S;
  set(patch: Partial<S>): void;
  keys: readonly (readonly [keyof S & string, string?])[];
}) {
  return (
    <>
      {keys.map(([key, unit]) => (
        <Field
          key={key}
          label={w(`fields.${key}`)}
          value={state[key]!}
          onChange={(value) => set({ [key]: value } as Partial<S>)}
          {...(unit ? { unit } : {})}
        />
      ))}
    </>
  );
}

function Result({
  answer,
  steps,
  latex,
  rows,
}: {
  answer: string;
  steps: readonly Step[];
  latex: string;
  rows?: [string, string][];
}) {
  return (
    <>
      <Answer text={answer} />
      {rows ? <Results rows={rows} /> : null}
      <StepList steps={steps} />
      <InsertMenu answer={answer} latex={latex} steps={steps} />
    </>
  );
}

const MRI = {
  sequence: 'spinEcho' as Sequence,
  b0: '1.5',
  t1: '900',
  t2: '100',
  pd: '1',
  t1b: '2500',
  t2b: '250',
  pdb: '1',
  tr: '500',
  te: '20',
  ti: '600',
  flip: '30',
};

function MriMode() {
  const [state, set] = useStored('medimaging.mri', MRI);
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const a = { t1: num(state.t1), t2: num(state.t2), pd: num(state.pd) };
        const b = { t1: num(state.t1b), t2: num(state.t2b), pd: num(state.pdb) };
        const at = (tissue: typeof a, tr: number) =>
          mriSignal(state.sequence, tissue, tr, num(state.te), num(state.ti), num(state.flip)).signal;
        const trs = Array.from({ length: 101 }, (_, i) => 10 + i * 50);
        return {
          one: mriSignal(state.sequence, a, num(state.tr), num(state.te), num(state.ti), num(state.flip)),
          two: mriSignal(state.sequence, b, num(state.tr), num(state.te), num(state.ti), num(state.flip)),
          larmor: larmor(num(state.b0)),
          trs,
          curveA: trs.map((tr) => at(a, tr)),
          curveB: trs.map((tr) => at(b, tr)),
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <Choice
          label={w('sequence')}
          value={state.sequence}
          options={['spinEcho', 'gradientEcho', 'inversionRecovery'] as const}
          name={(s) => w(`sequences.${s}`)}
          onChange={(sequence) => set({ sequence })}
        />
        <NumberFields
          state={state}
          set={set}
          keys={[
            ['b0', 'T'],
            ['tr', 'ms'],
            ['te', 'ms'],
            ...(state.sequence === 'inversionRecovery' ? [['ti', 'ms'] as const] : []),
            ...(state.sequence === 'gradientEcho' ? [['flip', '°'] as const] : []),
            ['t1', 'ms'],
            ['t2', 'ms'],
            ['pd'],
            ['t1b', 'ms'],
            ['t2b', 'ms'],
            ['pdb'],
          ]}
        />
      </Fields>
      {outcome.ok ? (
        <>
          <Plot
            ref={plot}
            title={w('contrastTitle')}
            spec={{
              series: [
                { label: w('tissueA'), x: outcome.value.trs, y: outcome.value.curveA },
                { label: w('tissueB'), x: outcome.value.trs, y: outcome.value.curveB, tone: 1 },
              ],
              xLabel: w('trAxis'),
              yLabel: w('signal'),
              markers: [{ x: num(state.tr), label: `TR = ${state.tr} ms` }],
            }}
          />
          <Result
            answer={w('mriAnswer', {
              a: fmt(outcome.value.one.signal),
              b: fmt(outcome.value.two.signal),
              f: fmt(outcome.value.larmor.mhz, 7),
            })}
            steps={[...outcome.value.larmor.steps, ...outcome.value.one.steps]}
            latex={String.raw`S = PD\,(1 - e^{-TR/T_1})\,e^{-TE/T_2}`}
            rows={[
              [w('contrast'), fmt(Math.abs(outcome.value.one.signal - outcome.value.two.signal))],
              [w('nullA'), `${fmt(outcome.value.one.nullTi)} ms`],
              [w('ernst'), `${fmt(outcome.value.one.ernst, 5)}°`],
            ]}
          />
          <Note>{w('gammaSource', { gamma: GAMMA_PROTON_MHZ_PER_T })}</Note>
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

type Experiment = 'single' | 'inversion' | 'echo';
const BLOCH_LATEX = String.raw`\dot{\mathbf{M}} = \gamma\mathbf{M}\times\mathbf{B} - \mathbf{M}_{xy}/T_2 - (M_z - M_0)\hat{z}/T_1`;

function BlochMode() {
  const [state, set] = useStored('medimaging.bloch', {
    experiment: 'echo' as Experiment,
    t1: '900',
    t2: '100',
    flip: '90',
    tau: '20',
    spread: '200',
  });
  const plot = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt(() => {
        const tau = num(state.tau);
        const pulses =
          state.experiment === 'single'
            ? [{ at: 0, flip: num(state.flip) }]
            : state.experiment === 'inversion'
              ? [
                  { at: 0, flip: 180 },
                  { at: tau, flip: 90 },
                ]
              : [
                  { at: 0, flip: 90 },
                  { at: tau, flip: 180 },
                ];
        const duration = state.experiment === 'single' ? 5 * num(state.t2) : 3 * tau;
        return bloch(
          num(state.t1),
          num(state.t2),
          pulses,
          duration,
          state.experiment === 'echo' ? num(state.spread) : 0,
          41,
        );
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <Choice
          label={w('experiment')}
          value={state.experiment}
          options={['single', 'inversion', 'echo'] as const}
          name={(e) => w(`experiments.${e}`)}
          onChange={(experiment) => set({ experiment })}
        />
        <NumberFields
          state={state}
          set={set}
          keys={[
            ['t1', 'ms'],
            ['t2', 'ms'],
            ...(state.experiment === 'single' ? [['flip', '°'] as const] : [['tau', 'ms'] as const]),
            ...(state.experiment === 'echo' ? [['spread', 'Hz'] as const] : []),
          ]}
        />
      </Fields>
      {outcome.ok ? (
        <>
          <Answer
            text={w('blochAnswer', { mz: fmt(outcome.value.mz.at(-1)!, 4), mxy: fmt(outcome.value.mxy.at(-1)!, 4) })}
          />
          <Plot
            ref={plot}
            title={w('blochTitle')}
            spec={{
              series: [
                { label: 'Mz', x: outcome.value.t, y: outcome.value.mz },
                { label: '|Mxy|', x: outcome.value.t, y: outcome.value.mxy, tone: 1 },
                { label: 'Mx', x: outcome.value.t, y: outcome.value.mx, tone: 3, dashed: true },
              ],
              xLabel: w('timeAxis'),
              yLabel: w('magnetization'),
            }}
          />
          <Note>{w('blochNote')}</Note>
          <InsertMenu
            answer={w('blochAnswer', { mz: fmt(outcome.value.mz.at(-1)!, 4), mxy: fmt(outcome.value.mxy.at(-1)!, 4) })}
            latex={BLOCH_LATEX}
            picture={() => plot.current?.picture('bloch') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

const rows = (image: Float64Array, size: number) =>
  Array.from({ length: size }, (_, r) => image.slice((size - 1 - r) * size, (size - r) * size));

function KSpaceMode() {
  const [state, set] = useStored('medimaging.kspace', { mask: 'center' as KMask, keep: '0.25' });
  const picture = useRef<PlotHandle>(null);
  const outcome = useMemo(() => attempt(() => kSpace(64, state.mask, num(state.keep))), [state]);
  const range: [number, number] = [0, 64];
  return (
    <>
      <Fields>
        <Choice
          label={w('mask')}
          value={state.mask}
          options={['full', 'center', 'edges', 'everyOther'] as const}
          name={(m) => w(`masks.${m}`)}
          onChange={(mask) => set({ mask })}
        />
        {state.mask === 'center' || state.mask === 'edges' ? (
          <Field label={w('keep')} value={state.keep} onChange={(keep) => set({ keep })} hint={w('keepHint')} />
        ) : null}
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('kAnswer', { share: fmt(outcome.value.kept * 100, 3) })} />
          <HeatMap
            title={w('kTitle')}
            spec={{
              values: rows(outcome.value.logMagnitude, 64),
              xRange: [-32, 32],
              yRange: [-32, 32],
              xLabel: 'kx',
              yLabel: 'ky',
            }}
          />
          <HeatMap
            ref={picture}
            title={w('imageTitle')}
            spec={{
              values: rows(outcome.value.rebuilt, 64),
              xRange: range,
              yRange: range,
              xLabel: 'x',
              yLabel: 'y',
              zRange: [0, 1],
            }}
          />
          <Note>{w('phantomSource')}</Note>
          <InsertMenu
            answer={w('kAnswer', { share: fmt(outcome.value.kept * 100, 3) })}
            picture={() => picture.current?.picture('k-space-image') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function CtMode() {
  const [state, set] = useStored('medimaging.ct', {
    mu: '0.21',
    muWater: '0.19',
    muAir: '0',
    width: '80',
    level: '40',
    x: '2',
  });
  const outcome = useMemo(
    () =>
      attempt(() => {
        const ct = hounsfield(num(state.mu), num(state.muWater), num(state.muAir));
        return {
          ct,
          gray: windowLevel(ct.hu, num(state.width), num(state.level)),
          beam: beerLambert(num(state.mu), num(state.x)),
        };
      }),
    [state],
  );
  return (
    <>
      <Fields>
        <NumberFields
          state={state}
          set={set}
          keys={[
            ['mu', 'cm⁻¹'],
            ['muWater', 'cm⁻¹'],
            ['muAir', 'cm⁻¹'],
            ['x', 'cm'],
            ['width', 'HU'],
            ['level', 'HU'],
          ]}
        />
      </Fields>
      {outcome.ok ? (
        <Result
          answer={w('ctAnswer', { hu: fmt(outcome.value.ct.hu) })}
          steps={[...outcome.value.ct.steps, ...outcome.value.beam.steps]}
          latex={String.raw`HU = 1000\,\frac{\mu - \mu_w}{\mu_w - \mu_{air}}`}
          rows={[
            [w('gray'), `${fmt(outcome.value.gray * 100, 4)}%`],
            [w('transmitted'), fmt(outcome.value.beam.transmitted)],
          ]}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
      <Note>{w('windowNote')}</Note>
    </>
  );
}

function UltrasoundMode() {
  const [state, set] = useStored('medimaging.ultrasound', {
    z1: '1.63',
    z2: '7.8',
    echo: '65',
    speed: '1540',
    alpha: '0.5',
    mhz: '5',
    velocity: '0.5',
    angle: '60',
  });
  const outcome = useMemo(
    () =>
      attempt(() => ({
        us: ultrasound(
          num(state.z1),
          num(state.z2),
          num(state.echo),
          num(state.speed),
          num(state.alpha),
          num(state.mhz),
        ),
        doppler: doppler(num(state.mhz), num(state.velocity), num(state.angle), num(state.speed)),
      })),
    [state],
  );
  return (
    <>
      <Fields>
        <NumberFields
          state={state}
          set={set}
          keys={[
            ['z1', 'MRayl'],
            ['z2', 'MRayl'],
            ['echo', 'µs'],
            ['speed', 'm/s'],
            ['alpha', 'dB/(cm·MHz)'],
            ['mhz', 'MHz'],
            ['velocity', 'm/s'],
            ['angle', '°'],
          ]}
        />
      </Fields>
      {outcome.ok ? (
        <Result
          answer={w('usAnswer', {
            r: fmt(outcome.value.us.reflection),
            depth: fmt(outcome.value.us.depthCm),
            shift: fmt(outcome.value.doppler.shift),
          })}
          steps={[...outcome.value.us.steps, ...outcome.value.doppler.steps]}
          latex={String.raw`R = \left(\frac{Z_2 - Z_1}{Z_2 + Z_1}\right)^2,\quad f_D = \frac{2 f_0 v \cos\theta}{c}`}
          rows={[
            [w('transmission'), fmt(outcome.value.us.transmission)],
            [w('roundTrip'), `${fmt(outcome.value.us.lossDb)} dB`],
          ]}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function XrayMode() {
  const [state, set] = useStored('medimaging.xray', { mu: '0.2', x: '5', intensity: '100', d1: '1', d2: '2' });
  const outcome = useMemo(
    () =>
      attempt(() => ({
        beam: beerLambert(num(state.mu), num(state.x)),
        far: inverseSquare(num(state.intensity), num(state.d1), num(state.d2)),
      })),
    [state],
  );
  return (
    <>
      <Fields>
        <NumberFields
          state={state}
          set={set}
          keys={[['mu', 'cm⁻¹'], ['x', 'cm'], ['intensity'], ['d1', 'm'], ['d2', 'm']]}
        />
      </Fields>
      {outcome.ok ? (
        <Result
          answer={w('xrayAnswer', {
            share: fmt(outcome.value.beam.transmitted * 100, 5),
            hvl: fmt(outcome.value.beam.hvl),
          })}
          steps={outcome.value.beam.steps}
          latex={String.raw`I = I_0 e^{-\mu x},\quad HVL = \frac{\ln 2}{\mu}`}
          rows={[[w('farIntensity'), fmt(outcome.value.far)]]}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function PetMode() {
  const [state, set] = useStored('medimaging.pet', {
    c: '5',
    dose: '370',
    mass: '70',
    minutes: '60',
    halfLife: '109.77',
    tof: '500',
  });
  const outcome = useMemo(
    () => attempt(() => suv(num(state.c), num(state.dose), num(state.mass), num(state.minutes), num(state.halfLife))),
    [state],
  );
  return (
    <>
      <Fields>
        <NumberFields
          state={state}
          set={set}
          keys={[
            ['c', 'kBq/mL'],
            ['dose', 'MBq'],
            ['mass', 'kg'],
            ['minutes', 'min'],
            ['halfLife', 'min'],
            ['tof', 'ps'],
          ]}
        />
      </Fields>
      {outcome.ok ? (
        <Result
          answer={w('petAnswer', { suv: fmt(outcome.value.value), corrected: fmt(outcome.value.corrected) })}
          steps={outcome.value.steps}
          latex={String.raw`SUV = \frac{C}{A/m}`}
          rows={[[w('tofResult'), `${fmt(tofPosition(num(state.tof)) * 100)} cm`]]}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
      <Note>{w('halfLifeNote')}</Note>
    </>
  );
}

export function MedImagingTool() {
  const [state, set] = useStored('medimaging', { mode: 'mri' as Mode });
  return (
    <div className={styles.tool}>
      <Note>{w('courseworkNote')}</Note>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => w(`modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'mri' ? <MriMode /> : null}
        {state.mode === 'bloch' ? <BlochMode /> : null}
        {state.mode === 'kspace' ? <KSpaceMode /> : null}
        {state.mode === 'ct' ? <CtMode /> : null}
        {state.mode === 'ultrasound' ? <UltrasoundMode /> : null}
        {state.mode === 'xray' ? <XrayMode /> : null}
        {state.mode === 'pet' ? <PetMode /> : null}
      </Tabs>
    </div>
  );
}
