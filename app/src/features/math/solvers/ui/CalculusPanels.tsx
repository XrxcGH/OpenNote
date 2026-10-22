// The calculus solvers: double and triple integrals, differential equations, and Taylor series.
import {
  REGION_PARAMS,
  REGION_SYSTEMS,
  SYSTEM_VARIABLES,
  regionLimits,
  solveIntegral,
  type CoordinateSystem,
  type Limit,
  type RegionKind,
} from '../multiple';
import { solveOde, type OdeInput, type OdeKind } from '../ode';
import { taylor } from '../series';
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

const REGIONS: readonly (RegionKind | 'custom')[] = [
  'rectangle',
  'between',
  'disk',
  'box',
  'cylinder',
  'ball',
  'cone',
  'custom',
];
const SYSTEMS: readonly CoordinateSystem[] = ['rectangular', 'polar', 'cylindrical', 'spherical'];

const FIRST_PARAMS: Record<string, string> = {
  a: '0',
  b: '1',
  c: '0',
  d: '1',
  e: '0',
  f: '1',
  g1: '0',
  g2: 'x',
  R: '1',
  h: '2',
};

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function IntegralsPanel() {
  const [state, set] = useStored('integrals', {
    region: 'ball' as RegionKind | 'custom',
    system: 'spherical' as CoordinateSystem,
    params: FIRST_PARAMS,
    integrand: '1',
    limits: [
      { variable: 'y', lower: '0', upper: 'x' },
      { variable: 'x', lower: '0', upper: '1' },
      { variable: 'z', lower: '0', upper: '1' },
    ] as Limit[],
    count: 2,
  });
  const custom = state.region === 'custom';
  const systems = custom ? SYSTEMS : REGION_SYSTEMS[state.region as RegionKind];
  const system = systems.includes(state.system) ? state.system : systems[0];
  const limits = custom
    ? state.limits.slice(0, state.count)
    : (regionLimits(state.region as RegionKind, system, state.params) ?? []);
  const { result, problem } = useSolved({ integrand: state.integrand, system, limits }, solveIntegral);
  const changeLimit = (i: number, patch: Partial<Limit>) =>
    set({ limits: state.limits.map((one, j) => (j === i ? { ...one, ...patch } : one)) });
  const names = ['solvers.ui.inner', 'solvers.ui.middle', 'solvers.ui.outer'];
  return (
    <div className={styles.panel}>
      <Row>
        <Choice
          label={say('solvers.ui.region')}
          value={state.region}
          options={REGIONS.map((value) => ({ value, label: say(`solvers.region.${value}`) }))}
          onChange={(region) => set({ region })}
        />
        <Choice
          label={say('solvers.ui.system')}
          value={system}
          options={systems.map((value) => ({ value, label: say(`solvers.system.${value}`) }))}
          onChange={(value) => set({ system: value })}
        />
        {custom && (
          <Choice
            label={say('solvers.ui.integrals')}
            value={String(state.count) as '2' | '3'}
            options={[
              { value: '2', label: say('solvers.ui.double') },
              { value: '3', label: say('solvers.ui.triple') },
            ]}
            onChange={(value) => set({ count: Number(value) })}
          />
        )}
      </Row>
      {!custom && (
        <Row>
          {REGION_PARAMS[state.region as RegionKind].map((key) => (
            <TextInput
              key={key}
              label={say(`solvers.param.${key}`)}
              value={state.params[key] ?? ''}
              onChange={(value) => set({ params: { ...state.params, [key]: value } })}
            />
          ))}
        </Row>
      )}
      <TextInput
        label={say('solvers.ui.integrand')}
        value={state.integrand}
        onChange={(integrand) => set({ integrand })}
        hint={say('solvers.ui.integrandHint', { variables: SYSTEM_VARIABLES[system].join(', ') })}
        wide
      />
      <table className={styles.table}>
        <caption className={styles.caption}>{say('solvers.ui.limits')}</caption>
        <thead>
          <tr>
            <th scope="col">{say('solvers.ui.integral')}</th>
            <th scope="col">{say('solvers.ui.variable')}</th>
            <th scope="col">{say('solvers.ui.lower')}</th>
            <th scope="col">{say('solvers.ui.upper')}</th>
          </tr>
        </thead>
        <tbody>
          {limits.map((one, i) => (
            <tr key={i}>
              <th scope="row">{say(names[limits.length === 2 && i === 1 ? 2 : i])}</th>
              {custom ? (
                (['variable', 'lower', 'upper'] as const).map((field) => (
                  <td key={field}>
                    <input
                      className={`${styles.input} ${styles.mono} ${styles.cell}`}
                      aria-label={`${say(names[limits.length === 2 && i === 1 ? 2 : i])}, ${say(`solvers.ui.${field}`)}`}
                      value={one[field]}
                      spellCheck={false}
                      onChange={(event) => changeLimit(i, { [field]: event.target.value })}
                    />
                  </td>
                ))
              ) : (
                <>
                  <td className={styles.mono}>{one.variable}</td>
                  <td className={styles.mono}>{one.lower}</td>
                  <td className={styles.mono}>{one.upper}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Problem text={problem} />
      {result && (
        <>
          <Result>
            {say(result.symbolic ? 'solvers.ui.integralExact' : 'solvers.ui.integralNumeric', {
              value: result.valueText,
            })}
          </Result>
          {result.outline && (
            <Plot
              label={say('solvers.ui.regionPlot')}
              equal
              layers={[
                { kind: 'area', points: result.outline, tone: 0 },
                { kind: 'line', points: [...result.outline, result.outline[0]], tone: 0 },
              ]}
            />
          )}
          <StepList steps={result.steps} />
        </>
      )}
      <Actions text={result ? stepsText(result.setup, result.steps) : null} />
    </div>
  );
}

const ODE_KINDS: readonly OdeKind[] = ['separable', 'linear', 'second'];

export function EquationsPanel() {
  const [state, set] = useStored('equations', {
    kind: 'second' as OdeKind,
    rhs: 'x*y',
    p: '2',
    q: '4',
    a: '1',
    b: '2',
    c: '5',
    g: '0',
    x0: '0',
    y0: '1',
    v0: '0',
    from: '0',
    to: '6',
  });
  const input: OdeInput = {
    kind: state.kind,
    rhs: state.rhs,
    p: state.p,
    q: state.q,
    a: state.a,
    b: state.b,
    c: state.c,
    g: state.g,
    x0: numberOf(state.x0),
    y0: numberOf(state.y0),
    v0: numberOf(state.v0),
    from: numberOf(state.from),
    to: numberOf(state.to),
  };
  const { result, problem } = useSolved(input, solveOde);
  return (
    <div className={styles.panel}>
      <Choice
        label={say('solvers.ui.equationKind')}
        value={state.kind}
        options={ODE_KINDS.map((value) => ({ value, label: say(`solvers.ode.${value}`) }))}
        onChange={(kind) => set({ kind })}
      />
      {state.kind === 'separable' && (
        <TextInput label={say('solvers.sym.dydx')} value={state.rhs} onChange={(rhs) => set({ rhs })} wide />
      )}
      {state.kind === 'linear' && (
        <Row>
          <TextInput label={say('solvers.sym.P')} value={state.p} onChange={(p) => set({ p })} />
          <TextInput label={say('solvers.sym.Q')} value={state.q} onChange={(q) => set({ q })} />
        </Row>
      )}
      {state.kind === 'second' && (
        <Row>
          <TextInput label={say('solvers.sym.a')} value={state.a} onChange={(a) => set({ a })} />
          <TextInput label={say('solvers.sym.b')} value={state.b} onChange={(b) => set({ b })} />
          <TextInput label={say('solvers.sym.c')} value={state.c} onChange={(c) => set({ c })} />
          <TextInput label={say('solvers.sym.g')} value={state.g} onChange={(g) => set({ g })} />
        </Row>
      )}
      <p className={styles.note}>{say(`solvers.ode.${state.kind}Form`)}</p>
      <Row>
        <TextInput label={say('solvers.sym.x0')} value={state.x0} onChange={(x0) => set({ x0 })} />
        <TextInput label={say('solvers.sym.y0')} value={state.y0} onChange={(y0) => set({ y0 })} />
        {state.kind === 'second' && (
          <TextInput label={say('solvers.sym.v0')} value={state.v0} onChange={(v0) => set({ v0 })} />
        )}
        <TextInput label={say('solvers.ui.from')} value={state.from} onChange={(from) => set({ from })} />
        <TextInput label={say('solvers.ui.to')} value={state.to} onChange={(to) => set({ to })} />
      </Row>
      <Problem text={problem} />
      {result && (
        <>
          <Result>{result.solution ? `y = ${result.solution}` : say('solvers.ui.numericOnly')}</Result>
          <Plot
            label={say(state.kind === 'second' ? 'solvers.ui.solutionPlot' : 'solvers.ui.slopeFieldPlot')}
            include={result.curve}
            layers={[
              ...(state.kind === 'second' ? [] : [{ kind: 'arrows' as const, arrows: result.field, tone: 6 }]),
              { kind: 'line', points: result.curve, tone: 0, label: say('solvers.ui.solution') },
              { kind: 'dots', points: [{ x: input.x0, y: input.y0 }], tone: 3 },
            ]}
          />
          {state.kind === 'second' && (
            <Plot
              label={say('solvers.ui.phasePlot')}
              include={result.phase}
              layers={[
                { kind: 'arrows', arrows: result.field, tone: 6 },
                { kind: 'line', points: result.phase, tone: 1, label: say('solvers.ui.phasePath') },
              ]}
            />
          )}
          <StepList steps={result.steps} />
        </>
      )}
      <Actions
        text={result ? stepsText(say(`solvers.ode.${state.kind}`), result.steps) : null}
        graph={result?.solution ? `y = ${graphLine(result.solution)}` : null}
      />
    </div>
  );
}

export function SeriesPanel() {
  const [state, set] = useStored('series', { f: 'sin(x)', center: '0', order: '5', at: '1', from: '-6', to: '6' });
  const input = {
    f: state.f,
    center: numberOf(state.center),
    order: numberOf(state.order),
    ...(state.at.trim() ? { at: numberOf(state.at) } : {}),
    from: numberOf(state.from),
    to: numberOf(state.to),
  };
  const { result, problem } = useSolved(input, taylor);
  const order = Math.round(input.order);
  return (
    <div className={styles.panel}>
      <TextInput label={say('solvers.sym.fx')} value={state.f} onChange={(f) => set({ f })} wide />
      <Row>
        <TextInput label={say('solvers.ui.center')} value={state.center} onChange={(center) => set({ center })} />
        <TextInput label={say('solvers.ui.order')} value={state.order} onChange={(value) => set({ order: value })} />
        <TextInput label={say('solvers.ui.boundAt')} value={state.at} onChange={(at) => set({ at })} />
        <TextInput label={say('solvers.ui.from')} value={state.from} onChange={(from) => set({ from })} />
        <TextInput label={say('solvers.ui.to')} value={state.to} onChange={(to) => set({ to })} />
      </Row>
      <Problem text={problem} />
      {result && (
        <>
          <Result>{`P${String(order).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])}(x) = ${result.polynomial}`}</Result>
          {result.remainder && (
            <p className={styles.note}>
              {say('solvers.ui.remainder', {
                bound: result.remainder.bound.toPrecision(3),
                actual: result.remainder.actual.toPrecision(3),
              })}
            </p>
          )}
          <Plot
            label={say('solvers.ui.seriesPlot')}
            include={result.graph.f}
            layers={[
              ...result.graph.partials
                .slice(0, -1)
                .map((points) => ({ kind: 'line' as const, points, tone: 5, faint: true })),
              { kind: 'line', points: result.graph.f, tone: 0, label: 'f(x)' },
              {
                kind: 'line',
                points: result.graph.partials.at(-1) ?? [],
                tone: 1,
                dashed: true,
                label: say('solvers.ui.partialSum'),
              },
            ]}
            view={(() => {
              const ys = result.graph.f.map((p) => p.y).filter(Number.isFinite);
              const [lo, hi] = ys.length ? [Math.min(...ys), Math.max(...ys)] : [-1, 1];
              const pad = Math.max(1, (hi - lo) * 0.4);
              return { xMin: input.from, xMax: input.to, yMin: lo - pad, yMax: hi + pad };
            })()}
          />
          <StepList steps={result.steps} />
        </>
      )}
      <Actions
        text={result ? stepsText(`f(x) = ${state.f}`, result.steps) : null}
        graph={result ? `y = ${graphLine(state.f)}\ny = ${graphLine(result.polynomial)}` : null}
      />
    </div>
  );
}
