// The image lab: one tab per kind of work on the shared image. Adjust (a histogram with window, level, stretch, and gamma),
// threshold and count, filter with kernels or Canny, morphology, the 2D spectrum with masks, and measurement. Band
// math and CT reconstruction are in ImageModes.tsx.
import { useMemo, useRef, type ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { fmt, readRows } from '../shared/num';
import { Plot, type PlotHandle } from '../shared/Plot';
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
} from '../shared/ui';
import type { Step } from '../shared/steps';
import styles from '../shared/kit.module.css';
import {
  KERNELS,
  adjust,
  calibrate,
  canny,
  components,
  convolve,
  edgeMagnitude,
  frequencyFilter,
  gray,
  histogram,
  kernel,
  morphology,
  otsu,
  readKernel,
  roiStats,
  stretch,
  threshold,
  type Gray,
  type KernelName,
  type Morphology,
} from './engine';
import { ImageView, type ImageContent } from './ImageView';
import { BandsMode, CtMode } from './ImageModes';
import { PictureSource } from './PictureSource';
import { usePicture } from './source';
import { w } from './words';

type Mode = 'adjust' | 'threshold' | 'filter' | 'morphology' | 'frequency' | 'measure' | 'bands' | 'ct';
const MODES: readonly Mode[] = ['threshold', 'adjust', 'filter', 'morphology', 'frequency', 'measure', 'bands', 'ct'];

/** Before and after, the answer, and the insert menu, as every simple tab shows them. */
function Shown(props: {
  before: ImageContent;
  after: ImageContent;
  answer: string;
  steps?: Step[];
  children?: ReactNode;
}) {
  const after = useRef<PlotHandle>(null);
  return (
    <>
      <Answer text={props.answer} />
      <div className={styles.pair}>
        <ImageView content={props.before} title={w('before')} description={w('beforeAlt')} />
        <ImageView ref={after} content={props.after} title={w('after')} description={props.answer} />
      </div>
      {props.children}
      {props.steps ? <StepList steps={props.steps} /> : null}
      <InsertMenu
        answer={props.answer}
        {...(props.steps ? { steps: props.steps } : {})}
        picture={() => after.current?.picture('image') ?? Promise.resolve(null)}
      />
    </>
  );
}
function AdjustMode() {
  const { image } = usePicture();
  const [state, set] = useStored('images.adjust', {
    how: 'window' as 'window' | 'stretch',
    width: '0.6',
    level: '0.45',
    gamma: '1',
    low: '1',
    high: '99',
  });
  const outcome = useMemo(
    () =>
      attempt(() =>
        state.how === 'window'
          ? { out: adjust(image, num(state.width), num(state.level), num(state.gamma)), range: null }
          : (() => {
              const s = stretch(image, num(state.low), num(state.high));
              return { out: adjust(s.image, 1, 0.5, num(state.gamma)), range: [s.low, s.high] as const };
            })(),
      ),
    [image, state],
  );
  const bins = histogram(image);
  return (
    <>
      <PictureSource />
      <Fields>
        <Choice
          label={w('how')}
          value={state.how}
          options={['window', 'stretch'] as const}
          name={(h) => w(`hows.${h}`)}
          onChange={(how) => set({ how })}
        />
        {state.how === 'window' ? (
          <>
            <Field label={w('windowWidth')} value={state.width} onChange={(width) => set({ width })} />
            <Field label={w('windowLevel')} value={state.level} onChange={(level) => set({ level })} />
          </>
        ) : (
          <>
            <Field label={w('lowPercent')} value={state.low} onChange={(low) => set({ low })} unit="%" />
            <Field label={w('highPercent')} value={state.high} onChange={(high) => set({ high })} unit="%" />
          </>
        )}
        <Field label={w('gamma')} value={state.gamma} onChange={(gamma) => set({ gamma })} />
      </Fields>
      <Plot
        title={w('histogramTitle')}
        spec={{
          series: [{ label: w('pixels'), x: bins.map((_, i) => i / 255), y: bins, kind: 'steps' }],
          xLabel: w('valueAxis'),
          yLabel: w('countAxis'),
        }}
      />
      {outcome.ok ? (
        <Shown
          before={{ kind: 'gray', image }}
          after={{ kind: 'gray', image: outcome.value.out }}
          answer={
            outcome.value.range
              ? w('stretchAnswer', { low: fmt(outcome.value.range[0], 3), high: fmt(outcome.value.range[1], 3) })
              : w('adjustAnswer')
          }
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function ThresholdMode() {
  const { image } = usePicture();
  const [state, set] = useStored('images.threshold', {
    how: 'otsu' as 'otsu' | 'manual',
    value: '0.5',
    connectivity: '8' as '4' | '8',
    scale: '1',
  });
  const outcome = useMemo(
    () =>
      attempt(() => {
        const levels = Array.from(image.data, (v) => v * 255);
        const found = state.how === 'otsu' ? otsu(levels) : null;
        const t0 = found ? found.threshold / 255 : num(state.value);
        const mask = threshold(image, t0);
        const result = components(mask, image.width, image.height, state.connectivity === '4' ? 4 : 8);
        return { t0, steps: found?.steps ?? [], ...result };
      }),
    [image, state],
  );
  const perUnit = num(state.scale) || 1;
  return (
    <>
      <PictureSource />
      <Fields>
        <Choice
          label={w('how')}
          value={state.how}
          options={['otsu', 'manual'] as const}
          name={(h) => w(`thresholds.${h}`)}
          onChange={(how) => set({ how })}
        />
        {state.how === 'manual' ? (
          <Field label={w('threshold')} value={state.value} onChange={(value) => set({ value })} />
        ) : null}
        <Choice
          label={w('connectivity')}
          value={state.connectivity}
          options={['4', '8'] as const}
          name={(c) => w(`connectivities.${c}`)}
          onChange={(connectivity) => set({ connectivity })}
        />
        <Field
          label={w('pixelsPerUnit')}
          value={state.scale}
          onChange={(scale) => set({ scale })}
          hint={w('scaleHint')}
        />
      </Fields>
      {outcome.ok ? (
        <Shown
          before={{ kind: 'gray', image }}
          after={{ kind: 'labels', width: image.width, height: image.height, labels: outcome.value.labels }}
          answer={w('countAnswer', { count: outcome.value.parts.length, t: fmt(outcome.value.t0, 4) })}
          steps={outcome.value.steps}
        >
          <DataTable
            caption={w('partsTable')}
            table={{
              header: [w('part'), w('area'), w('centroid')],
              rows: outcome.value.parts.map((p) => [
                String(p.label),
                fmt(p.area / perUnit ** 2, 5),
                `(${fmt(p.cx / perUnit, 4)}, ${fmt(p.cy / perUnit, 4)})`,
              ]),
            }}
          />
        </Shown>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function FilterMode() {
  const { image } = usePicture();
  const [state, set] = useStored('images.filter', {
    name: 'gaussian' as KernelName | 'edges' | 'canny',
    sigma: '1',
    custom: '0 -1 0\n-1 5 -1\n0 -1 0',
    low: '0.1',
    high: '0.3',
  });
  const outcome = useMemo(
    () =>
      attempt((): ImageContent => {
        if (state.name === 'edges') return { kind: 'gray', image: edgeMagnitude(image), stretch: true };
        if (state.name === 'canny') {
          const edges = canny(image, num(state.sigma), num(state.low), num(state.high));
          return { kind: 'gray', image: gray(image.width, image.height, edges) };
        }
        const k = state.name === 'custom' ? readKernel(readRows(state.custom)) : kernel(state.name, num(state.sigma));
        return {
          kind: 'gray',
          image: convolve(image, k),
          stretch: state.name.startsWith('sobel') || state.name.startsWith('prewitt') || state.name === 'laplacian',
        };
      }),
    [image, state],
  );
  const options = [...KERNELS, 'edges', 'canny'] as const;
  return (
    <>
      <PictureSource />
      <Fields>
        <Choice
          label={w('kernel')}
          value={state.name}
          options={options}
          name={(k) => w(`kernels.${k}`)}
          onChange={(name) => set({ name })}
        />
        {state.name === 'gaussian' || state.name === 'canny' ? (
          <Field label={w('sigma')} value={state.sigma} onChange={(sigma) => set({ sigma })} />
        ) : null}
        {state.name === 'custom' ? (
          <TextBox
            label={w('customKernel')}
            value={state.custom}
            onChange={(custom) => set({ custom })}
            hint={w('customHint')}
            rows={3}
          />
        ) : null}
        {state.name === 'canny' ? (
          <>
            <Field label={w('cannyLow')} value={state.low} onChange={(low) => set({ low })} />
            <Field label={w('cannyHigh')} value={state.high} onChange={(high) => set({ high })} />
          </>
        ) : null}
      </Fields>
      {outcome.ok ? (
        <Shown
          before={{ kind: 'gray', image }}
          after={outcome.value}
          answer={w('filterAnswer', { name: w(`kernels.${state.name}`) })}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
      <Note>{w('edgeNote')}</Note>
    </>
  );
}

function MorphologyMode() {
  const { image } = usePicture();
  const [state, set] = useStored('images.morphology', { op: 'open' as Morphology, radius: '1' });
  const outcome = useMemo(() => attempt(() => morphology(image, state.op, num(state.radius))), [image, state]);
  return (
    <>
      <PictureSource />
      <Fields>
        <Choice
          label={w('operation')}
          value={state.op}
          options={['erode', 'dilate', 'open', 'close'] as const}
          name={(o) => w(`operations.${o}`)}
          onChange={(op) => set({ op })}
        />
        <Field label={w('radius')} value={state.radius} onChange={(radius) => set({ radius })} unit="px" />
      </Fields>
      {outcome.ok ? (
        <Shown
          before={{ kind: 'gray', image }}
          after={{ kind: 'gray', image: outcome.value }}
          answer={w('morphologyAnswer', { op: w(`operations.${state.op}`), size: 2 * num(state.radius) + 1 })}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function FrequencyMode() {
  const { image } = usePicture();
  const [state, set] = useStored('images.frequency', { kind: 'lowpass' as 'lowpass' | 'highpass', radius: '0.2' });
  const outcome = useMemo(() => attempt(() => frequencyFilter(image, state.kind, num(state.radius))), [image, state]);
  return (
    <>
      <PictureSource />
      <Fields>
        <Choice
          label={w('mask')}
          value={state.kind}
          options={['lowpass', 'highpass'] as const}
          name={(k) => w(`masks.${k}`)}
          onChange={(kind) => set({ kind })}
        />
        <Field
          label={w('maskRadius')}
          value={state.radius}
          onChange={(radius) => set({ radius })}
          hint={w('maskHint')}
        />
      </Fields>
      {outcome.ok ? (
        <Shown
          before={{ kind: 'gray', image: outcome.value.spectrum }}
          after={{ kind: 'gray', image: outcome.value.filtered, stretch: true }}
          answer={w('frequencyAnswer', { kind: w(`masks.${state.kind}`) })}
        />
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

function measure(image: Gray, s: Record<string, string>) {
  const cal = calibrate(num(s.x1!), num(s.y1!), num(s.x2!), num(s.y2!), num(s.length!));
  const roi = roiStats(image, num(s.rx0!), num(s.ry0!), num(s.rx1!), num(s.ry1!));
  return { cal, roi, distance: Math.hypot(num(s.dx1!) - num(s.dx0!), num(s.dy1!) - num(s.dy0!)) / cal.perUnit };
}

function MeasureMode() {
  const { image } = usePicture();
  const [state, set] = useStored('images.measure', {
    x1: '0',
    y1: '0',
    x2: '50',
    y2: '0',
    length: '10',
    unit: 'µm',
    dx0: '10',
    dy0: '10',
    dx1: '40',
    dy1: '50',
    rx0: '20',
    ry0: '20',
    rx1: '40',
    ry1: '40',
  });
  const outcome = useMemo(() => attempt(() => measure(image, state)), [image, state]);
  const field = (key: keyof typeof state, unit?: string) => (
    <Field
      key={key}
      label={w(`measureFields.${key}`)}
      value={state[key]}
      onChange={(value) => set({ [key]: value })}
      {...(unit ? { unit } : {})}
    />
  );
  return (
    <>
      <PictureSource />
      <Fields>
        {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => field(k, 'px'))}
        {field('length')}
        <Field label={w('measureFields.unit')} value={state.unit} onChange={(unit) => set({ unit })} />
        {(['dx0', 'dy0', 'dx1', 'dy1', 'rx0', 'ry0', 'rx1', 'ry1'] as const).map((k) => field(k, 'px'))}
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={w('measureAnswer', { distance: `${fmt(outcome.value.distance, 5)} ${state.unit}` })} />
          <Results
            rows={[
              [w('scale'), w('scaleValue', { value: fmt(outcome.value.cal.perUnit, 5), unit: state.unit })],
              [w('roiMean'), fmt(outcome.value.roi.mean, 4)],
              [w('roiSd'), fmt(outcome.value.roi.sd, 4)],
              [w('roiRange'), `${fmt(outcome.value.roi.min, 4)} – ${fmt(outcome.value.roi.max, 4)}`],
              [w('roiArea'), `${fmt(outcome.value.roi.count / outcome.value.cal.perUnit ** 2, 5)} ${state.unit}²`],
            ]}
          />
          <InsertMenu answer={w('measureAnswer', { distance: `${fmt(outcome.value.distance, 5)} ${state.unit}` })} />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
      <Note>{w('measureNote')}</Note>
    </>
  );
}

export function ImagesTool() {
  const [state, set] = useStored('images', { mode: 'threshold' as Mode });
  return (
    <div className={styles.tool}>
      <Tabs
        label={t('kitSignals.ui.modes')}
        value={state.mode}
        options={MODES}
        name={(mode) => w(`modes.${mode}`)}
        onChange={(mode) => set({ mode })}
      >
        {state.mode === 'adjust' ? <AdjustMode /> : null}
        {state.mode === 'threshold' ? <ThresholdMode /> : null}
        {state.mode === 'filter' ? <FilterMode /> : null}
        {state.mode === 'morphology' ? <MorphologyMode /> : null}
        {state.mode === 'frequency' ? <FrequencyMode /> : null}
        {state.mode === 'measure' ? <MeasureMode /> : null}
        {state.mode === 'bands' ? <BandsMode /> : null}
        {state.mode === 'ct' ? <CtMode /> : null}
      </Tabs>
    </div>
  );
}
