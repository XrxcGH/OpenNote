// The probability, matrix, and projectile solvers.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../ui';
import { eigen } from '../eigen';
import { niceNumber, numberText } from '../expr';
import { probability, quantile, regression, type Distribution, type Region } from '../probability';
import { dragFactor, simulate } from '../projectile';
import type { XY } from '../steps';
import { Plot } from './Plot';
import {
  Actions,
  Choice,
  Problem,
  Result,
  Row,
  StepList,
  TextInput,
  useSolved,
  numberOf,
  say,
  stepsText,
  useStored,
} from './parts';
import styles from './solvers.module.css';

type DistKind = Distribution['kind'];
type RegionKind = Region['kind'];

export function ProbabilityPanel() {
  const [state, set] = useStored('probability', {
    kind: 'normal' as DistKind,
    mean: '0',
    sd: '1',
    n: '20',
    p: '0.3',
    df: '10',
    region: 'between' as RegionKind,
    a: '-1.96',
    b: '1.96',
    level: '0.95',
    data: '1, 2.1\n2, 3.9\n3, 6.2\n4, 7.8\n5, 10.1',
  });
  const dist: Distribution =
    state.kind === 'normal'
      ? { kind: 'normal', mean: numberOf(state.mean), sd: numberOf(state.sd) }
      : state.kind === 'binomial'
        ? { kind: 'binomial', n: numberOf(state.n), p: numberOf(state.p) }
        : { kind: 't', df: numberOf(state.df) };
  const [a, b] = [numberOf(state.a), numberOf(state.b)];
  const region: Region =
    state.region === 'below'
      ? { kind: 'below', b }
      : state.region === 'above'
        ? { kind: 'above', a }
        : { kind: state.region, a, b };
  const area = useSolved({ dist, region }, (i) => probability(i.dist, i.region));
  const level = numberOf(state.level);
  const critical = useSolved({ dist, level }, (i) =>
    i.level > 0 && i.level < 1 ? quantile(i.dist, (1 + i.level) / 2) : null,
  ).result;
  const points: XY[] = state.data
    .split(/\n/)
    .map((line) =>
      line
        .split(/[,;\t ]+/)
        .filter(Boolean)
        .map(Number),
    )
    .filter((pair) => pair.length >= 2)
    .map(([x, y]) => ({ x, y }));
  const fit = useSolved(points, regression);
  const xs = points.map((p) => p.x).filter(Number.isFinite);
  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby="solvers-distribution">
        <h3 id="solvers-distribution" className={styles.heading}>
          {say('solvers.ui.distribution')}
        </h3>
        <Row>
          <Choice
            label={say('solvers.ui.distributionKind')}
            value={state.kind}
            options={(['normal', 'binomial', 't'] as const).map((value) => ({
              value,
              label: say(`solvers.dist.${value}`),
            }))}
            onChange={(kind) => set({ kind })}
          />
          {state.kind === 'normal' && (
            <>
              <TextInput label={say('solvers.sym.mu')} value={state.mean} onChange={(mean) => set({ mean })} />
              <TextInput label={say('solvers.sym.sigma')} value={state.sd} onChange={(sd) => set({ sd })} />
            </>
          )}
          {state.kind === 'binomial' && (
            <>
              <TextInput label={say('solvers.sym.n')} value={state.n} onChange={(n) => set({ n })} />
              <TextInput label={say('solvers.sym.p')} value={state.p} onChange={(p) => set({ p })} />
            </>
          )}
          {state.kind === 't' && (
            <TextInput label={say('solvers.ui.df')} value={state.df} onChange={(df) => set({ df })} />
          )}
        </Row>
        <Row>
          <Choice
            label={say('solvers.ui.area')}
            value={state.region}
            options={(['below', 'above', 'between', 'outside'] as const).map((value) => ({
              value,
              label: say(`solvers.area.${value}`),
            }))}
            onChange={(value) => set({ region: value })}
          />
          {state.region !== 'below' && (
            <TextInput label={say('solvers.sym.a')} value={state.a} onChange={(value) => set({ a: value })} />
          )}
          {state.region !== 'above' && (
            <TextInput label={say('solvers.sym.b')} value={state.b} onChange={(value) => set({ b: value })} />
          )}
        </Row>
        <Problem text={area.problem} />
        {area.result && (
          <>
            <Result>{say('solvers.ui.probability', { p: numberText(area.result.probability, 6) })}</Result>
            {state.kind === 'binomial' ? (
              <Plot
                label={say('solvers.ui.binomialPlot')}
                layers={[
                  {
                    kind: 'bars',
                    bars: area.result.bars.map((bar) => ({ x: bar.k, y: bar.p, shaded: bar.shaded })),
                    tone: 0,
                  },
                ]}
              />
            ) : (
              <Plot
                label={say('solvers.ui.densityPlot')}
                layers={[
                  ...area.result.shaded.map((points) => ({ kind: 'area' as const, points, tone: 0 })),
                  { kind: 'line', points: area.result.curve, tone: 0 },
                ]}
              />
            )}
            <StepList steps={area.result.steps} />
          </>
        )}
        <Row>
          <TextInput
            label={say('solvers.ui.confidence')}
            value={state.level}
            onChange={(value) => set({ level: value })}
          />
          {critical !== null && (
            <p className={styles.note}>{say('solvers.ui.critical', { value: numberText(critical, 6) })}</p>
          )}
        </Row>
        <Actions text={area.result ? stepsText(say(`solvers.dist.${state.kind}`), area.result.steps) : null} />
      </section>
      <section className={styles.section} aria-labelledby="solvers-regression">
        <h3 id="solvers-regression" className={styles.heading}>
          {say('solvers.ui.regression')}
        </h3>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>{say('solvers.ui.points')}</span>
          <textarea
            className={`${styles.input} ${styles.mono} ${styles.textarea}`}
            rows={5}
            value={state.data}
            spellCheck={false}
            onChange={(event) => set({ data: event.target.value })}
          />
        </label>
        <Problem text={fit.problem} />
        {fit.result && (
          <>
            <Result>{`y = ${numberText(fit.result.slope, 6)}·x ${fit.result.intercept < 0 ? '−' : '+'} ${numberText(Math.abs(fit.result.intercept), 6)},  R² = ${numberText(fit.result.r2, 5)}`}</Result>
            <Plot
              label={say('solvers.ui.regressionPlot')}
              layers={[
                { kind: 'dots', points, tone: 3, label: say('solvers.ui.data') },
                {
                  kind: 'line',
                  tone: 0,
                  label: say('solvers.ui.fit'),
                  points: [Math.min(...xs), Math.max(...xs)].map((x) => ({
                    x,
                    y: fit.result!.slope * x + fit.result!.intercept,
                  })),
                },
              ]}
            />
            <StepList steps={fit.result.steps} />
          </>
        )}
        <Actions text={fit.result ? stepsText(say('solvers.ui.regression'), fit.result.steps) : null} />
      </section>
    </div>
  );
}

export function MatricesPanel() {
  const [state, set] = useStored('matrices', { size: '2', cells: ['2', '1', '0', '1', '2', '0', '0', '0', '1'] });
  const n = state.size === '3' ? 3 : 2;
  const matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => numberOf(state.cells[i * 3 + j] ?? '')),
  );
  const { result, problem } = useSolved(matrix, eigen);
  return (
    <div className={styles.panel}>
      <Choice
        label={say('solvers.ui.size')}
        value={state.size as '2' | '3'}
        options={[
          { value: '2', label: '2 × 2' },
          { value: '3', label: '3 × 3' },
        ]}
        onChange={(size) => set({ size })}
      />
      <div
        className={styles.matrix}
        role="group"
        aria-label={say('solvers.ui.matrix')}
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 6rem))` }}
      >
        {matrix.map((row, i) =>
          row.map((_, j) => (
            <input
              key={`${i}-${j}`}
              className={`${styles.input} ${styles.mono}`}
              aria-label={say('solvers.ui.entry', { row: i + 1, column: j + 1 })}
              value={state.cells[i * 3 + j] ?? ''}
              spellCheck={false}
              onChange={(event) =>
                set({ cells: state.cells.map((cell, k) => (k === i * 3 + j ? event.target.value : cell)) })
              }
            />
          )),
        )}
      </div>
      <Problem text={problem} />
      {result && (
        <>
          <Result>
            {result.pairs
              .map(
                (pair) =>
                  `λ = ${pair.value.im === 0 ? niceNumber(pair.value.re) : `${niceNumber(pair.value.re)} ${pair.value.im < 0 ? '−' : '+'} ${niceNumber(Math.abs(pair.value.im))}i`}`,
              )
              .join(',  ')}
          </Result>
          <Plot
            label={say(n === 2 ? 'solvers.ui.transformPlot2' : 'solvers.ui.transformPlot3')}
            equal
            layers={[
              { kind: 'segments', lines: result.plot.before, tone: 6, faint: true, label: say('solvers.ui.before') },
              { kind: 'segments', lines: result.plot.after, tone: 0, label: say('solvers.ui.after') },
              {
                kind: 'segments',
                lines: result.plot.eigenLines,
                tone: 1,
                dashed: true,
                label: say('solvers.ui.eigenvectors'),
              },
            ]}
          />
          <StepList steps={result.steps} />
        </>
      )}
      <Actions text={result ? stepsText(say('solvers.ui.matrix'), result.steps) : null} />
    </div>
  );
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function ProjectilePanel() {
  const [state, set] = useStored('projectile', {
    speed: '25',
    angle: '40',
    height: '1.5',
    gravity: '9.81',
    drag: false,
    mass: '0.145',
    coefficient: '0.47',
    diameter: '0.074',
    density: '1.225',
  });
  const k = state.drag
    ? dragFactor(
        numberOf(state.density),
        numberOf(state.coefficient),
        Math.PI * (numberOf(state.diameter) / 2) ** 2,
        numberOf(state.mass),
      )
    : 0;
  const input = {
    speed: numberOf(state.speed),
    angle: numberOf(state.angle),
    height: numberOf(state.height),
    gravity: numberOf(state.gravity),
    drag: k,
  };
  const { result, problem } = useSolved(input, simulate);
  const [played, setPlayed] = useState<{ of: unknown; frame: number } | null>(null);
  const frame = played && played.of === result ? played.frame : null;
  const setFrame = (next: number) => setPlayed({ of: result, frame: next });
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const play = () => {
    if (!result) return;
    cancelAnimationFrame(raf.current);
    if (reducedMotion()) return setFrame(result.path.length - 1);
    const start = performance.now();
    // Real time, but never longer than four seconds on screen.
    const duration = Math.min(4000, result.time * 1000);
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / duration);
      setFrame(Math.round(u * (result.path.length - 1)));
      if (u < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const vacuumPath = result
    ? Array.from({ length: 101 }, (_, i) => {
        const t = (result.vacuum.time * i) / 100;
        const theta = (input.angle * Math.PI) / 180;
        return {
          x: input.speed * Math.cos(theta) * t,
          y: input.height + input.speed * Math.sin(theta) * t - (input.gravity * t * t) / 2,
        };
      })
    : [];
  const at = frame !== null && result ? result.path[Math.min(frame, result.path.length - 1)] : null;
  const rows: [string, number, string][] = result
    ? [
        ['solvers.ui.range', result.range, 'm'],
        ['solvers.ui.maxHeight', result.maxHeight, 'm'],
        ['solvers.ui.flightTime', result.time, 's'],
        ['solvers.ui.impactSpeed', result.impactSpeed, 'm/s'],
        ['solvers.ui.impactAngle', result.impactAngle, '°'],
      ]
    : [];
  return (
    <div className={styles.panel}>
      <Row>
        <TextInput label={say('solvers.ui.speed')} value={state.speed} onChange={(speed) => set({ speed })} />
        <TextInput label={say('solvers.ui.angle')} value={state.angle} onChange={(angle) => set({ angle })} />
        <TextInput label={say('solvers.ui.height')} value={state.height} onChange={(height) => set({ height })} />
        <TextInput label={say('solvers.ui.gravity')} value={state.gravity} onChange={(gravity) => set({ gravity })} />
      </Row>
      <label className={styles.check}>
        <input type="checkbox" checked={state.drag} onChange={(event) => set({ drag: event.target.checked })} />
        {say('solvers.ui.drag')}
      </label>
      {state.drag && (
        <Row>
          <TextInput label={say('solvers.ui.mass')} value={state.mass} onChange={(mass) => set({ mass })} />
          <TextInput
            label={say('solvers.ui.dragCoefficient')}
            value={state.coefficient}
            onChange={(coefficient) => set({ coefficient })}
          />
          <TextInput
            label={say('solvers.ui.diameter')}
            value={state.diameter}
            onChange={(diameter) => set({ diameter })}
          />
          <TextInput label={say('solvers.ui.density')} value={state.density} onChange={(density) => set({ density })} />
        </Row>
      )}
      <Problem text={problem} />
      {result && (
        <>
          <Result>
            {say('solvers.ui.flightSummary', {
              range: numberText(result.range, 4),
              height: numberText(result.maxHeight, 4),
              time: numberText(result.time, 3),
            })}
          </Result>
          <table className={styles.table}>
            <caption className={styles.caption}>{say('solvers.ui.flight')}</caption>
            <tbody>
              {rows.map(([key, value, unit]) => (
                <tr key={key}>
                  <th scope="row">{say(key)}</th>
                  <td className={styles.mono}>{`${numberText(value, 6)} ${unit}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Plot
            label={say('solvers.ui.trajectoryPlot')}
            equal
            marker={at}
            layers={[
              ...(state.drag
                ? [
                    {
                      kind: 'line' as const,
                      points: vacuumPath,
                      tone: 6,
                      dashed: true,
                      label: say('solvers.ui.noDrag'),
                    },
                  ]
                : []),
              { kind: 'line', points: result.path, tone: 0, label: say('solvers.ui.path') },
            ]}
          />
          <div className={styles.buttons}>
            <Button onClick={play}>{say('solvers.ui.play')}</Button>
          </div>
          <StepList steps={result.steps} />
        </>
      )}
      <Actions text={result ? stepsText(say('solvers.tab.projectile'), result.steps) : null} />
    </div>
  );
}
