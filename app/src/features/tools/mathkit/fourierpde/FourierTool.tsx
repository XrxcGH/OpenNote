// Fourier series and boundary value problems: the coefficients of a piecewise function with a partial-sum plot, and
// the heat, wave, and Laplace equations solved by separation of variables.
import '../text';
import { t } from '../../../../strings/t';
import { numberOf } from '../expr';
import { fmt } from '../numeric';
import { KitError } from '../types';
import styles from '../ui/mathkit.module.css';
import {
  Choice,
  InsertBar,
  LinePlot,
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
import {
  fourierSeries,
  solveBvp,
  solveLaplace,
  type Conditions,
  type FourierResult,
  type LaplaceSolution,
  type SeriesSolution,
  type Side,
} from './engine';

type Kind = 'full' | 'sine' | 'cosine' | 'heat' | 'wave' | 'laplace';

const FIRST = {
  problem: 'full' as Kind,
  fn: 'x ; -pi ; pi',
  length: 'pi',
  terms: '10',
  initial: 'x ; 0 ; 0.5\n1-x ; 0.5 ; 1',
  velocity: '0',
  rod: '1',
  conditions: 'DD' as Conditions,
  speed: '1',
  robin: '1',
  times: '0, 0.05, 0.1, 0.2',
  width: '2',
  height: '1',
  side: 'top' as Side,
  data: 'sin(pi*x/2)',
};
type State = typeof FIRST;

const whole = (text: string): number => {
  const n = numberOf(text);
  if (!Number.isInteger(n)) throw new KitError('badTerms');
  return n;
};

type Run =
  | { kind: 'series'; out: FourierResult }
  | { kind: 'bvp'; out: SeriesSolution }
  | { kind: 'laplace'; out: LaplaceSolution };

function run(s: State): Run {
  const terms = whole(s.terms);
  if (s.problem === 'full' || s.problem === 'sine' || s.problem === 'cosine') {
    return { kind: 'series', out: fourierSeries(s.fn, s.problem, numberOf(s.length), terms) };
  }
  if (s.problem === 'laplace') {
    return { kind: 'laplace', out: solveLaplace(numberOf(s.width), numberOf(s.height), s.side, s.data, terms) };
  }
  return {
    kind: 'bvp',
    out: solveBvp({
      equation: s.problem,
      conditions: s.conditions,
      L: numberOf(s.rod),
      speed: numberOf(s.speed),
      initial: s.initial,
      velocity: s.problem === 'wave' ? s.velocity : undefined,
      terms,
      h: numberOf(s.robin),
      times: s.times.split(',').map(numberOf),
    }),
  };
}

function SeriesOutput({ out, terms }: { out: FourierResult; terms: number }) {
  const shown = Math.min(out.a.length, out.b.length, 8);
  const rows = Array.from({ length: shown }, (_, i) => [String(i + 1), fmt(out.a[i], 6), fmt(out.b[i], 6)]);
  const lines = [
    t('kitMath.fourier.a0', { a0: fmt(out.a0, 8) }),
    t('kitMath.fourier.parseval', { lhs: fmt(out.parseval.integral, 8), rhs: fmt(out.parseval.series, 8) }),
  ];
  if (out.gibbs) {
    lines.push(
      t('kitMath.fourier.gibbs', {
        percent: fmt((100 * out.gibbs.overshoot) / Math.abs(out.gibbs.jump), 4),
        jump: fmt(out.gibbs.jump, 6),
      }),
    );
  }
  const plot: Series[] = [
    { points: out.samples.f, tone: 5 },
    { points: out.samples.sum, tone: 0 },
  ];
  return (
    <>
      <Result>{lines.join('\n')}</Result>
      <table className={styles.table} aria-label={t('kitMath.fourier.table')}>
        <thead>
          <tr>
            <th scope="col">{t('kitMath.fourier.colN')}</th>
            <th scope="col">{t('kitMath.fourier.colA')}</th>
            <th scope="col">{t('kitMath.fourier.colB')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <LinePlot label={t('kitMath.fourier.plotSeries')} series={plot} />
      <Steps steps={out.steps} />
      <InsertBar
        answer={t('kitMath.fourier.answerSeries', { terms })}
        steps={out.steps}
        table={{ header: ['n', 'a(n)', 'b(n)'], rows }}
      />
    </>
  );
}

function BvpOutput({ out, terms }: { out: SeriesSolution; terms: number }) {
  const plot: Series[] = out.snapshots.map((snap, index) => ({ points: snap.points, tone: index }));
  const rows = out.coefficients.slice(0, 8).map((c, i) => [String(i + 1), fmt(c, 8)]);
  return (
    <>
      <LinePlot label={t('kitMath.fourier.plotTimes')} series={plot} />
      <Steps steps={out.steps} />
      <InsertBar
        answer={t('kitMath.fourier.answerBvp', { terms })}
        steps={out.steps}
        table={{ header: ['n', 'c(n)'], rows }}
      />
    </>
  );
}

function LaplaceOutput({ out, terms }: { out: LaplaceSolution; terms: number }) {
  const rows = out.grid.map((row) => row.map((v) => fmt(v, 5)));
  return (
    <>
      <table className={styles.table} aria-label={t('kitMath.fourier.gridTitle')}>
        <caption>{t('kitMath.fourier.gridTitle')}</caption>
        <tbody>
          {rows.map((row, j) => (
            <tr key={j}>
              {row.map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Steps steps={out.steps} />
      <InsertBar
        answer={t('kitMath.fourier.answerBvp', { terms })}
        steps={out.steps}
        table={{ header: ['1', '2', '3', '4', '5'], rows }}
      />
    </>
  );
}

const CONDITIONS: Conditions[] = ['DD', 'NN', 'DN', 'ND', 'DR'];
const KINDS: Kind[] = ['full', 'sine', 'cosine', 'heat', 'wave', 'laplace'];
const SIDES: Side[] = ['top', 'bottom', 'left', 'right'];
const cap = (word: string) => word[0].toUpperCase() + word.slice(1);

export default function FourierTool() {
  const [state, set] = useStored('fourier', FIRST);
  const { result, problem }: { result: Run | null; problem: string } = useSolved({ ...state }, run);
  const p = state.problem;
  const isSeries = p === 'full' || p === 'sine' || p === 'cosine';
  const terms = Number(state.terms);
  return (
    <div className={styles.panel}>
      <Choice
        label={t('kitMath.fourier.problem')}
        value={p}
        options={KINDS.map((value) => ({ value, label: say(`kitMath.fourier.problem${cap(value)}`) }))}
        onChange={(next) => set({ problem: next })}
      />
      {isSeries ? (
        <div className={styles.row}>
          <TextInput
            wide
            rows={3}
            label={t('kitMath.fourier.function')}
            value={state.fn}
            invalid={problem !== ''}
            onChange={(fn) => set({ fn })}
          />
          <TextInput label={t('kitMath.fourier.length')} value={state.length} onChange={(length) => set({ length })} />
        </div>
      ) : null}
      {p === 'heat' || p === 'wave' ? (
        <>
          <div className={styles.row}>
            <TextInput label={t('kitMath.fourier.rodLength')} value={state.rod} onChange={(rod) => set({ rod })} />
            <TextInput label={t('kitMath.fourier.speed')} value={state.speed} onChange={(speed) => set({ speed })} />
            <Choice
              label={t('kitMath.fourier.conditions')}
              value={state.conditions}
              options={CONDITIONS.map((value) => ({ value, label: say(`kitMath.fourier.cond${value}`) }))}
              onChange={(conditions) => set({ conditions })}
            />
            {state.conditions === 'DR' ? (
              <TextInput label={t('kitMath.fourier.robin')} value={state.robin} onChange={(robin) => set({ robin })} />
            ) : null}
          </div>
          <TextInput
            wide
            rows={3}
            label={t('kitMath.fourier.initial')}
            value={state.initial}
            invalid={problem !== ''}
            onChange={(initial) => set({ initial })}
          />
          {p === 'wave' ? (
            <TextInput
              wide
              rows={2}
              label={t('kitMath.fourier.velocity')}
              value={state.velocity}
              onChange={(velocity) => set({ velocity })}
            />
          ) : null}
          <TextInput wide label={t('kitMath.fourier.times')} value={state.times} onChange={(times) => set({ times })} />
        </>
      ) : null}
      {p === 'laplace' ? (
        <>
          <div className={styles.row}>
            <TextInput label={t('kitMath.fourier.width')} value={state.width} onChange={(width) => set({ width })} />
            <TextInput
              label={t('kitMath.fourier.height')}
              value={state.height}
              onChange={(height) => set({ height })}
            />
            <Choice
              label={t('kitMath.fourier.side')}
              value={state.side}
              options={SIDES.map((value) => ({ value, label: say(`kitMath.fourier.side${cap(value)}`) }))}
              onChange={(side) => set({ side })}
            />
          </div>
          <TextInput
            wide
            rows={3}
            label={t('kitMath.fourier.data')}
            value={state.data}
            invalid={problem !== ''}
            onChange={(data) => set({ data })}
          />
        </>
      ) : null}
      <TextInput label={t('kitMath.fourier.terms')} value={state.terms} onChange={(next) => set({ terms: next })} />
      <Note>{t('kitMath.fourier.assumptions')}</Note>
      <Note>{t('kitMath.fourier.hint')}</Note>
      <Problem text={problem} />
      {result?.kind === 'series' ? <SeriesOutput out={result.out} terms={terms} /> : null}
      {result?.kind === 'bvp' ? <BvpOutput out={result.out} terms={terms} /> : null}
      {result?.kind === 'laplace' ? <LaplaceOutput out={result.out} terms={terms} /> : null}
    </div>
  );
}
