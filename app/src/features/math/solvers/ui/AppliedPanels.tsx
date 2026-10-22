// The transform, root, and error solvers: Laplace and Fourier transforms with their tables, root finding with its
// iteration table, and error propagation with the unit consistency checker.
import { useState } from 'react';
import { checkUnits } from '../dimensions';
import { namesIn, numberText, read } from '../expr';
import { findRoot, type RootMethod } from '../roots';
import {
  FOURIER_PAIRS,
  FOURIER_PROPERTIES,
  LAPLACE_PAIRS,
  LAPLACE_PROPERTIES,
  fourier,
  inverseFourier,
  inverseLaplace,
  laplace,
  searchTable,
  type Pair,
} from '../transforms';
import { propagate } from '../uncertainty';
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
  graphLine,
  numberOf,
  say,
  stepsText,
  useStored,
} from './parts';
import styles from './solvers.module.css';

type TransformKind = 'laplace' | 'inverseLaplace' | 'fourier' | 'inverseFourier';
const TRANSFORMS: readonly TransformKind[] = ['laplace', 'inverseLaplace', 'fourier', 'inverseFourier'];
const RUN: Record<TransformKind, (text: string) => ReturnType<typeof laplace>> = {
  laplace,
  inverseLaplace,
  fourier,
  inverseFourier,
};

function PairTable({
  caption,
  rows,
  left,
  right,
  names,
}: {
  caption: string;
  rows: readonly Pair[];
  left: string;
  right: string;
  names?: string;
}) {
  return (
    <table className={styles.table}>
      <caption className={styles.caption}>{caption}</caption>
      <thead>
        <tr>
          {names && <th scope="col">{say('solvers.ui.property')}</th>}
          <th scope="col">{left}</th>
          <th scope="col">{right}</th>
          {!names && <th scope="col">{say('solvers.ui.condition')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((pair) => (
          <tr key={pair.id}>
            {names && <th scope="row">{say(`${names}.${pair.id}`)}</th>}
            <td className={styles.mono}>{pair.f}</td>
            <td className={styles.mono}>{pair.F}</td>
            {!names && <td className={styles.mono}>{pair.condition ?? ''}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TransformsPanel() {
  const [state, set] = useStored('transforms', {
    kind: 'laplace' as TransformKind,
    text: 't*exp(-2*t)*sin(3*t)',
    search: '',
  });
  const { result, problem } = useSolved({ kind: state.kind, text: state.text }, (i) => RUN[i.kind](i.text));
  const laplaceSide = state.kind === 'laplace' || state.kind === 'inverseLaplace';
  const names = (prefix: string) => (id: string) => {
    try {
      return say(`${prefix}.${id}`);
    } catch {
      return '';
    }
  };
  const pairs = searchTable(laplaceSide ? LAPLACE_PAIRS : FOURIER_PAIRS, state.search);
  const propsPrefix = laplaceSide ? 'solvers.laplaceProperty' : 'solvers.fourierProperty';
  const properties = searchTable(
    laplaceSide ? LAPLACE_PROPERTIES : FOURIER_PROPERTIES,
    state.search,
    names(propsPrefix),
  );
  const variable =
    state.kind === 'laplace'
      ? 'f(t)'
      : state.kind === 'inverseLaplace'
        ? 'F(s)'
        : state.kind === 'fourier'
          ? 'f(t)'
          : 'F(ω)';
  return (
    <div className={styles.panel}>
      <Choice
        label={say('solvers.ui.transform')}
        value={state.kind}
        options={TRANSFORMS.map((value) => ({ value, label: say(`solvers.transform.${value}`) }))}
        onChange={(kind) => set({ kind })}
      />
      <TextInput label={variable} value={state.text} onChange={(text) => set({ text })} wide />
      <Problem text={problem} />
      {result && (
        <>
          <Result>{result.text}</Result>
          {!result.checked && <p className={styles.note}>{say('solvers.ui.notChecked')}</p>}
          <Plot
            label={say(`solvers.ui.transformPlot.${state.kind}`)}
            layers={[{ kind: 'line', points: result.graph, tone: 0 }]}
          />
          <StepList steps={result.steps} />
        </>
      )}
      <Actions text={result ? stepsText(`${variable} = ${state.text}`, result.steps) : null} />
      <section className={styles.tables} aria-label={say('solvers.ui.tables')}>
        <TextInput
          label={say('solvers.ui.searchTables')}
          value={state.search}
          onChange={(search) => set({ search })}
          mono={false}
          wide
        />
        <PairTable
          caption={say(laplaceSide ? 'solvers.ui.laplacePairs' : 'solvers.ui.fourierPairs')}
          rows={pairs}
          left="f(t)"
          right={laplaceSide ? 'F(s)' : 'F(ω)'}
        />
        <PairTable
          caption={say('solvers.ui.properties')}
          rows={properties}
          left="f(t)"
          right={laplaceSide ? 'F(s)' : 'F(ω)'}
          names={propsPrefix}
        />
        {!pairs.length && !properties.length && <p className={styles.note}>{say('solvers.ui.noRows')}</p>}
      </section>
    </div>
  );
}

const METHODS: readonly RootMethod[] = ['newton', 'bisection', 'secant'];

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function RootsPanel() {
  const [state, set] = useStored('roots', {
    f: 'x^3 - 2*x - 5',
    method: 'newton' as RootMethod,
    x0: '2',
    x1: '3',
    tolerance: '1e-10',
    max: '50',
  });
  const input = {
    f: state.f,
    method: state.method,
    x0: numberOf(state.x0),
    x1: numberOf(state.x1),
    tolerance: Number(state.tolerance) > 0 ? Number(state.tolerance) : 1e-10,
    maxIterations: Math.round(numberOf(state.max)) || 50,
  };
  const { result, problem } = useSolved(input, findRoot);
  const second =
    state.method === 'newton'
      ? null
      : say(state.method === 'bisection' ? 'solvers.ui.rightEnd' : 'solvers.ui.secondGuess');
  return (
    <div className={styles.panel}>
      <TextInput label={say('solvers.sym.fx')} value={state.f} onChange={(f) => set({ f })} wide />
      <Row>
        <Choice
          label={say('solvers.ui.method')}
          value={state.method}
          options={METHODS.map((value) => ({ value, label: say(`solvers.method.${value}`) }))}
          onChange={(method) => set({ method })}
        />
        <TextInput
          label={say(state.method === 'bisection' ? 'solvers.ui.leftEnd' : 'solvers.ui.firstGuess')}
          value={state.x0}
          onChange={(x0) => set({ x0 })}
        />
        {second && <TextInput label={second} value={state.x1} onChange={(x1) => set({ x1 })} />}
        <TextInput
          label={say('solvers.ui.tolerance')}
          value={state.tolerance}
          onChange={(tolerance) => set({ tolerance })}
        />
        <TextInput label={say('solvers.ui.maxSteps')} value={state.max} onChange={(max) => set({ max })} />
      </Row>
      <Problem text={problem} />
      {result && (
        <>
          <Result>
            {say(`solvers.outcome.${result.outcome}`, {
              root: result.root === null ? '' : numberText(result.root, 12),
            })}
          </Result>
          <Plot
            label={say('solvers.ui.rootPlot')}
            layers={[
              { kind: 'line', points: result.graph.f, tone: 0, label: 'f(x)' },
              {
                kind: 'segments',
                lines: result.graph.lines,
                tone: 1,
                dashed: true,
                label: say(`solvers.ui.rootLines.${state.method}`),
              },
              { kind: 'dots', points: result.rows.map((row) => ({ x: row.x, y: 0 })), tone: 3 },
            ]}
            view={(() => {
              const ys = result.graph.f.map((p) => p.y).filter(Number.isFinite);
              const xs = result.graph.f.map((p) => p.x);
              const [lo, hi] = ys.length ? [Math.min(0, ...ys), Math.max(0, ...ys)] : [-1, 1];
              return {
                xMin: Math.min(...xs),
                xMax: Math.max(...xs),
                yMin: lo - (hi - lo) * 0.1 - 1e-9,
                yMax: hi + (hi - lo) * 0.1 + 1e-9,
              };
            })()}
          />
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className={styles.caption}>{say('solvers.ui.iterations')}</caption>
              <thead>
                <tr>
                  <th scope="col">{say('solvers.sym.n')}</th>
                  {state.method === 'bisection' && <th scope="col">{say('solvers.sym.bracket')}</th>}
                  <th scope="col">{say('solvers.sym.xn')}</th>
                  <th scope="col">{say('solvers.sym.fxn')}</th>
                  {state.method === 'newton' && <th scope="col">{say('solvers.sym.dfxn')}</th>}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.n}>
                    <td>{row.n}</td>
                    {state.method === 'bisection' && (
                      <td
                        className={styles.mono}
                      >{`[${numberText(row.a ?? NaN, 8)}, ${numberText(row.b ?? NaN, 8)}]`}</td>
                    )}
                    <td className={styles.mono}>{numberText(row.x, 12)}</td>
                    <td className={styles.mono}>{numberText(row.fx, 4)}</td>
                    {state.method === 'newton' && <td className={styles.mono}>{numberText(row.dfx ?? NaN, 6)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <StepList steps={result.steps} />
        </>
      )}
      <Actions
        text={result ? stepsText(`f(x) = ${state.f}`, result.steps) : null}
        graph={result ? `y = ${graphLine(state.f)}` : null}
      />
    </div>
  );
}

/** The letters an expression uses, in the order they first appear, or none when it cannot be read. */
function lettersOf(text: string): string[] {
  try {
    return [...namesIn(read(text))];
  } catch {
    return [];
  }
}

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function ErrorsPanel() {
  const [state, set] = useStored('errors', {
    expression: '4*pi^2*L/T^2',
    values: { L: '1.000', T: '2.007' } as Record<string, string>,
    sigmas: { L: '0.005', T: '0.010' } as Record<string, string>,
    equation: 'x = x0 + v*t + a*t^2/2',
    units: { x: 'm', x0: 'm', v: 'm/s', t: 's', a: 'm/s^2' } as Record<string, string>,
  });
  const letters = lettersOf(state.expression);
  const measured = letters.map((name) => ({
    name,
    value: numberOf(state.values[name] ?? ''),
    uncertainty: numberOf(state.sigmas[name] ?? '0'),
  }));
  const propagation = useSolved({ expression: state.expression, measured }, (i) => propagate(i.expression, i.measured));
  const unitLetters = lettersOf(state.equation.replace('=', '+'));
  const unitMap = Object.fromEntries(unitLetters.filter((n) => state.units[n]?.trim()).map((n) => [n, state.units[n]]));
  const check = useSolved({ equation: state.equation, units: unitMap }, (i) => checkUnits(i.equation, i.units));
  const [focus, setFocus] = useState<number | null>(null);
  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby="solvers-errors">
        <h3 id="solvers-errors" className={styles.heading}>
          {say('solvers.ui.uncertainty')}
        </h3>
        <TextInput
          label={say('solvers.sym.fEquals')}
          value={state.expression}
          onChange={(expression) => set({ expression })}
          wide
        />
        {letters.map((name) => (
          <Row key={name}>
            <TextInput
              label={say('solvers.ui.valueOf', { name })}
              value={state.values[name] ?? ''}
              onChange={(value) => set({ values: { ...state.values, [name]: value } })}
            />
            <TextInput
              label={say('solvers.ui.sigmaOf', { name })}
              value={state.sigmas[name] ?? ''}
              onChange={(value) => set({ sigmas: { ...state.sigmas, [name]: value } })}
            />
          </Row>
        ))}
        <Problem text={propagation.problem} />
        {propagation.result && (
          <>
            <Result>{`f = ${propagation.result.text}`}</Result>
            <ul className={styles.shares}>
              {propagation.result.contributions.map((c) => (
                <li key={c.name}>{say('solvers.ui.share', { name: c.name, percent: (c.share * 100).toFixed(1) })}</li>
              ))}
            </ul>
            <StepList steps={propagation.result.steps} />
          </>
        )}
        <Actions text={propagation.result ? stepsText(`f = ${state.expression}`, propagation.result.steps) : null} />
      </section>
      <section className={styles.section} aria-labelledby="solvers-units">
        <h3 id="solvers-units" className={styles.heading}>
          {say('solvers.ui.unitCheck')}
        </h3>
        <TextInput
          label={say('solvers.ui.equation')}
          value={state.equation}
          onChange={(equation) => set({ equation })}
          invalid={check.result ? !check.result.ok : false}
          wide
        />
        {focus !== null && check.result?.problems[focus] && (
          <p className={`${styles.mono} ${styles.underline}`} aria-hidden="true">
            {state.equation.slice(0, check.result.problems[focus].start)}
            <mark>{state.equation.slice(check.result.problems[focus].start, check.result.problems[focus].end)}</mark>
            {state.equation.slice(check.result.problems[focus].end)}
          </p>
        )}
        <Row>
          {unitLetters.map((name) => (
            <TextInput
              key={name}
              label={say('solvers.ui.unitOf', { name })}
              value={state.units[name] ?? ''}
              onChange={(value) => set({ units: { ...state.units, [name]: value } })}
            />
          ))}
        </Row>
        <p className={styles.note}>{say('solvers.ui.unitHelp')}</p>
        <Problem text={check.problem} />
        {check.result && (
          <>
            <Result>{say(check.result.ok ? 'solvers.ui.unitsOk' : 'solvers.ui.unitsWrong')}</Result>
            {check.result.problems.length > 0 && (
              <ul className={styles.problems}>
                {check.result.problems.map((p, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => setFocus(i)}
                      onFocus={() => setFocus(i)}
                    >
                      {say(`solvers.unitProblem.${p.code}`, {
                        left: p.left ?? '',
                        right: p.right ?? '',
                        name: p.name ?? '',
                        text: state.equation.slice(p.start, p.end),
                      })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <StepList steps={check.result.steps} />
          </>
        )}
      </section>
    </div>
  );
}
