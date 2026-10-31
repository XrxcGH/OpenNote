// The image lab's band and CT tabs. Band math (NDVI or a typed expression of the bands), false-color composites,
// and minimum-distance classification from training rectangles. CT turns the phantom or the image into a sinogram
// and back by filtered back-projection, with CT numbers.
import { useMemo, useRef } from 'react';
import { fmt, readRows } from '../shared/num';
import {
  Answer,
  Choice,
  Field,
  Fields,
  InsertMenu,
  Note,
  Problem,
  Results,
  TextBox,
  attempt,
  num,
  useStored,
} from '../shared/ui';
import styles from '../shared/kit.module.css';
import type { PlotHandle } from '../shared/Plot';
import { phantom } from '../medimaging/engine';
import { bandMath, classify, gray, type ReconFilter } from './engine';
import { HEAVY_SIZE, TaskProgress, useTask } from '../shared/useTask';
import { ImageView, type ImageContent } from './ImageView';
import { PictureSource } from './PictureSource';
import { usePicture } from './source';
import { w } from './words';

type BandTask = 'ndvi' | 'expression' | 'composite' | 'classify';

export function BandsMode() {
  const picture = usePicture();
  const [state, set] = useStored('images.bands', {
    task: 'ndvi' as BandTask,
    expression: '(b1 - b2)/(b1 + b2)',
    order: '1 2 3',
    training: '1 2 2 10 10\n2 40 5 50 15\n3 50 50 60 60',
  });
  const view = useRef<PlotHandle>(null);
  const outcome = useMemo(
    () =>
      attempt((): { content: ImageContent; answer: string } => {
        const bands = picture.bands;
        if (state.task === 'composite') {
          const [r, g, b] = readRows(state.order)[0] ?? [];
          const pick = (k: number | undefined) => bands[(k ?? 1) - 1] ?? bands[0]!;
          return { content: { kind: 'rgb', r: pick(r), g: pick(g), b: pick(b) }, answer: w('compositeAnswer') };
        }
        if (state.task === 'classify') {
          const width = bands[0]!.width;
          const training = readRows(state.training).map(([label, x0, y0, x1, y1]) => {
            const pixels: number[] = [];
            for (let y = y0!; y <= y1!; y += 1) for (let x = x0!; x <= x1!; x += 1) pixels.push(y * width + x);
            return { label: label!, pixels: pixels.filter((p) => p >= 0 && p < bands[0]!.data.length) };
          });
          const labels = classify(bands, training);
          return {
            content: { kind: 'labels', width, height: bands[0]!.height, labels },
            answer: w('classifyAnswer', { count: training.length }),
          };
        }
        const out = bandMath(state.task === 'ndvi' ? '(b1 - b2)/(b1 + b2)' : state.expression, bands);
        const mean = out.data.reduce((a, b) => a + b, 0) / out.data.length;
        return {
          content: { kind: 'gray', image: out, stretch: true },
          answer: w('bandAnswer', { mean: fmt(mean, 4) }),
        };
      }),
    [picture, state],
  );
  return (
    <>
      <PictureSource />
      <Note>
        {w('bandsNote', { names: picture.bandNames.map((n, i) => `b${i + 1} = ${w(`bandNames.${n}`)}`).join(', ') })}
      </Note>
      <Fields>
        <Choice
          label={w('task')}
          value={state.task}
          options={['ndvi', 'expression', 'composite', 'classify'] as const}
          name={(k) => w(`bandTasks.${k}`)}
          onChange={(task) => set({ task })}
        />
        {state.task === 'expression' ? (
          <Field
            label={w('expression')}
            value={state.expression}
            onChange={(expression) => set({ expression })}
            hint={w('expressionHint')}
            wide
          />
        ) : null}
        {state.task === 'composite' ? (
          <Field label={w('order')} value={state.order} onChange={(order) => set({ order })} hint={w('orderHint')} />
        ) : null}
        {state.task === 'classify' ? (
          <TextBox
            label={w('training')}
            value={state.training}
            onChange={(training) => set({ training })}
            hint={w('trainingHint')}
            rows={3}
          />
        ) : null}
      </Fields>
      {outcome.ok ? (
        <>
          <Answer text={outcome.value.answer} />
          <ImageView
            ref={view}
            content={outcome.value.content}
            title={w(`bandTasks.${state.task}`)}
            description={outcome.value.answer}
          />
          <InsertMenu
            answer={outcome.value.answer}
            {...(state.task === 'ndvi'
              ? { latex: String.raw`\mathrm{NDVI} = \frac{\mathrm{NIR} - \mathrm{Red}}{\mathrm{NIR} + \mathrm{Red}}` }
              : {})}
            picture={() => view.current?.picture('bands') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}

export function CtMode() {
  const picture = usePicture();
  const [state, set] = useStored('images.ct', {
    source: 'phantom' as 'phantom' | 'image',
    angles: '180',
    filter: 'ramLak' as ReconFilter,
  });
  const view = useRef<PlotHandle>(null);
  const object = useMemo(
    () => (state.source === 'phantom' ? gray(64, 64, phantom(64)) : picture.image),
    [picture, state.source],
  );
  const angles = num(state.angles);
  const run = useTask(
    'ct',
    useMemo(() => ({ object, angles, filter: state.filter }), [object, angles, state.filter]),
    object.width * object.height * (angles || 0) > 25 * HEAVY_SIZE,
  );
  const outcome = useMemo(() => {
    if (!run.outcome?.ok) return run.outcome;
    const { sinogram, image } = run.outcome.value;
    const side = image.width;
    const centre = image.data[Math.floor(side / 2) * side + Math.floor(side / 2)]!;
    // Treat the object's value 1 as water: HU = 1000 (v − 1)/1, with v the reconstructed value.
    return { ok: true as const, value: { object, sinogram, image, hu: (1000 * (centre - 1)) / 1 } };
  }, [run.outcome, object]);
  return (
    <>
      <Fields>
        <Choice
          label={w('ctSource')}
          value={state.source}
          options={['phantom', 'image'] as const}
          name={(s) => w(`ctSources.${s}`)}
          onChange={(source) => set({ source })}
        />
        <Field label={w('angles')} value={state.angles} onChange={(angles) => set({ angles })} />
        <Choice
          label={w('reconFilter')}
          value={state.filter}
          options={['ramLak', 'sheppLogan', 'none'] as const}
          name={(f) => w(`reconFilters.${f}`)}
          onChange={(filter) => set({ filter })}
        />
      </Fields>
      <TaskProgress progress={run.progress} cancel={run.cancel} />
      {outcome === null ? null : outcome.ok ? (
        <>
          <Answer text={w('ctAnswer', { angles: state.angles, filter: w(`reconFilters.${state.filter}`) })} />
          <div className={styles.pair}>
            <ImageView
              content={{ kind: 'gray', image: outcome.value.sinogram, stretch: true }}
              title={w('sinogram')}
              description={w('sinogramAlt')}
            />
            <ImageView
              ref={view}
              content={{ kind: 'gray', image: outcome.value.image, stretch: true }}
              title={w('reconstruction')}
              description={w('reconstructionAlt')}
            />
          </div>
          <Results rows={[[w('centreHu'), `${fmt(outcome.value.hu, 4)} HU`]]} />
          <Note>{w('ctNote')}</Note>
          <InsertMenu
            answer={w('ctAnswer', { angles: state.angles, filter: w(`reconFilters.${state.filter}`) })}
            picture={() => view.current?.picture('ct-reconstruction') ?? Promise.resolve(null)}
          />
        </>
      ) : (
        <Problem text={outcome.problem} />
      )}
    </>
  );
}
