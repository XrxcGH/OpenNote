// Systems of ODEs and phase portraits: a linear system or a second-order equation with its eigenvalue analysis, or a
// nonlinear system with its equilibria, nullclines and trajectories, drawn as a phase portrait.
import '../text';
import { t } from '../../../../strings/t';
import { numberOf } from '../expr';
import { fmt } from '../numeric';
import styles from '../ui/mathkit.module.css';
import {
  Choice,
  InsertBar,
  LinePlot,
  MathView,
  Note,
  Problem,
  Result,
  Steps,
  TextInput,
  say,
  useSolved,
  useStored,
  type Series,
} from '../ui/parts';
import { analyzeLinear, analyzeNonlinear, analyzeSecondOrder, type LinearResult, type NonlinearResult } from './engine';

type Mode = 'linear' | 'second' | 'nonlinear';

const FIRST = {
  mode: 'linear' as Mode,
  a: '0',
  b: '1',
  c: '-2',
  d: '-3',
  p: '3',
  q: '2',
  f: 'x*(1-0.5*y)',
  g: 'y*(-0.75+0.25*x)',
  window: '-1, 6, -1, 5',
};

type State = typeof FIRST;

function run(state: State) {
  if (state.mode === 'linear') {
    const [a, b, c, d] = [state.a, state.b, state.c, state.d].map(numberOf);
    return { kind: 'linear' as const, out: analyzeLinear(a, b, c, d) };
  }
  if (state.mode === 'second') {
    return { kind: 'linear' as const, out: analyzeSecondOrder(numberOf(state.p), numberOf(state.q)) };
  }
  const w = state.window.split(',').map(numberOf);
  return { kind: 'nonlinear' as const, out: analyzeNonlinear(state.f, state.g, [w[0], w[1], w[2], w[3]]) };
}

type Run = ReturnType<typeof run>;

const kindText = (kind: string) => say(`kitMath.odes.kind.${kind}`);

function linearSeries(r: LinearResult): Series[] {
  return [
    ...r.field.map((points): Series => ({ points, tone: 5 })),
    ...r.trajectories.map((points): Series => ({ points, tone: 0 })),
    ...r.axes.map((points): Series => ({ points, tone: 3, dashed: true })),
  ];
}

function traceDetSeries(r: LinearResult): Series[] {
  return [
    { points: r.traceDet.parabola, tone: 1 },
    ...r.traceDet.axes.map((points): Series => ({ points, tone: 5, dashed: true })),
    { points: [r.traceDet.point], tone: 3, dots: true },
  ];
}

function nonlinearSeries(r: NonlinearResult): Series[] {
  return [
    ...r.field.map((points): Series => ({ points, tone: 5 })),
    ...r.trajectories.map((points): Series => ({ points, tone: 0 })),
    ...r.nullclines.f.map((points): Series => ({ points, tone: 1, dashed: true })),
    ...r.nullclines.g.map((points): Series => ({ points, tone: 2, dashed: true })),
    ...r.cycles.map((cycle): Series => ({ points: cycle.path, tone: 4 })),
    { points: r.equilibria.map((e): [number, number] => [e.x, e.y]), tone: 3, dots: true },
  ];
}

function LinearOutput({ out }: { out: LinearResult }) {
  const k = out.classification;
  const eig = k.eigenvalues
    .map(([re, im]) => (im === 0 ? fmt(re, 8) : `${fmt(re, 8)} ${im < 0 ? '−' : '+'} ${fmt(Math.abs(im), 8)}i`))
    .join(', ');
  const answer = t('kitMath.odes.classified', { kind: kindText(k.kind) });
  return (
    <>
      <Result>
        {[
          answer,
          t('kitMath.odes.eigenvalues', { values: eig }),
          t('kitMath.odes.trace', { trace: fmt(k.trace, 8), det: fmt(k.det, 8) }),
        ].join('\n')}
      </Result>
      <MathView latex={out.generalSolution} />
      <MathView latex={out.fundamental} />
      <LinePlot equal label={t('kitMath.odes.plot')} series={linearSeries(out)} />
      <LinePlot label={t('kitMath.odes.plotTraceDet')} series={traceDetSeries(out)} />
      <Steps steps={out.steps} />
      <InsertBar
        answer={`${answer} ${t('kitMath.odes.eigenvalues', { values: eig })}`}
        latex={out.generalSolution}
        steps={out.steps}
      />
    </>
  );
}

function NonlinearOutput({ out }: { out: NonlinearResult }) {
  const rows = out.equilibria.map((e) => ({
    key: e.inconclusive ? 'kitMath.odes.equilibriumOpen' : 'kitMath.odes.equilibrium',
    text: say(e.inconclusive ? 'kitMath.odes.equilibriumOpen' : 'kitMath.odes.equilibrium', {
      x: fmt(e.x, 8),
      y: fmt(e.y, 8),
      kind: kindText(e.classification.kind),
    }),
  }));
  return (
    <>
      <Result>
        {[
          ...rows.map((row) => row.text),
          ...out.cycles.map((cycle) =>
            t(cycle.stable ? 'kitMath.odes.cycleStableLine' : 'kitMath.odes.cycleUnstableLine', {
              at: `(${fmt(cycle.around[0], 6)}, ${fmt(cycle.around[1], 6)})`,
              x: fmt(cycle.crossing, 6),
              period: fmt(cycle.period, 6),
            }),
          ),
        ].join('\n')}
      </Result>
      <LinePlot label={t('kitMath.odes.plot')} series={nonlinearSeries(out)} />
      <Steps steps={out.steps} />
      <InsertBar
        answer={rows.map((row) => row.text).join('; ')}
        latex={`J=${out.jacobianLatex}`}
        steps={out.steps}
        table={{
          header: ['x', 'y', 'trace', 'det', 'type'],
          rows: out.equilibria.map((e) => [
            fmt(e.x, 8),
            fmt(e.y, 8),
            fmt(e.classification.trace, 6),
            fmt(e.classification.det, 6),
            kindText(e.classification.kind),
          ]),
        }}
      />
    </>
  );
}

function Fields({ state, set }: { state: State; set: (patch: Partial<State>) => void }) {
  if (state.mode === 'linear') {
    return (
      <div className={styles.row}>
        <TextInput label={t('kitMath.odes.a')} value={state.a} onChange={(a) => set({ a })} />
        <TextInput label={t('kitMath.odes.b')} value={state.b} onChange={(b) => set({ b })} />
        <TextInput label={t('kitMath.odes.c')} value={state.c} onChange={(c) => set({ c })} />
        <TextInput label={t('kitMath.odes.d')} value={state.d} onChange={(d) => set({ d })} />
      </div>
    );
  }
  if (state.mode === 'second') {
    return (
      <div className={styles.row}>
        <TextInput label={t('kitMath.odes.p')} value={state.p} onChange={(p) => set({ p })} />
        <TextInput label={t('kitMath.odes.q')} value={state.q} onChange={(q) => set({ q })} />
      </div>
    );
  }
  return (
    <>
      <TextInput wide label={t('kitMath.odes.fx')} value={state.f} onChange={(f) => set({ f })} />
      <TextInput wide label={t('kitMath.odes.gy')} value={state.g} onChange={(g) => set({ g })} />
      <TextInput wide label={t('kitMath.odes.window')} value={state.window} onChange={(window) => set({ window })} />
    </>
  );
}

export default function OdeTool() {
  const [state, set] = useStored('odes', FIRST);
  const { result, problem }: { result: Run | null; problem: string } = useSolved({ ...state }, run);
  return (
    <div className={styles.panel}>
      <Choice
        label={t('kitMath.odes.mode')}
        value={state.mode}
        options={[
          { value: 'linear', label: t('kitMath.odes.modeLinear') },
          { value: 'second', label: t('kitMath.odes.modeSecond') },
          { value: 'nonlinear', label: t('kitMath.odes.modeNonlinear') },
        ]}
        onChange={(mode) => set({ mode })}
      />
      <Fields state={state} set={set} />
      <Note>{t('kitMath.odes.assumptions')}</Note>
      {state.mode === 'nonlinear' ? <Note>{t('kitMath.odes.hint')}</Note> : null}
      <Problem text={problem} />
      {result?.kind === 'linear' ? <LinearOutput out={result.out} /> : null}
      {result?.kind === 'nonlinear' ? <NonlinearOutput out={result.out} /> : null}
    </div>
  );
}
