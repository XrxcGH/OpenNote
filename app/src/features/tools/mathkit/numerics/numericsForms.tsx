// The fields of each numerical method: what to ask for, in the order a student works.
import type { ReactNode } from 'react';
import { Choice, say } from '../ui/parts';
import type { State, Topic } from './numericsRun';

export interface Ctx {
  s: State;
  set: (patch: Partial<State>) => void;
  text: (key: keyof State, label: string, extra?: { wide?: boolean; rows?: number }) => ReactNode;
  L: (name: string) => string;
}

const options = <T extends string>(group: string, values: readonly T[]) =>
  values.map((value) => ({ value, label: say(`kitMath.numerics.${group}.${value}`) }));

export const topicOptions = (topics: readonly Topic[]) => options('topic', topics);

const functionFields = (c: Ctx, extra: ReactNode) => (
  <>
    {c.text('fx', c.L('function'), { wide: true })}
    {extra}
  </>
);

function interpForm(c: Ctx) {
  const { s, set, text, L } = c;
  return (
    <>
      <Choice
        label={L('method')}
        value={s.interpMethod}
        options={options('interpMethod', ['lagrange', 'newton', 'natural', 'clamped'] as const)}
        onChange={(interpMethod) => set({ interpMethod })}
      />
      {text('at', L('evaluateAt'))}
      {s.interpMethod === 'clamped' ? (
        <>
          {text('slope0', L('slopeStart'))}
          {text('slopeN', L('slopeEnd'))}
        </>
      ) : null}
      {text('points', L('points'), { wide: true, rows: 5 })}
    </>
  );
}

function diffForm(c: Ctx) {
  const { s, set, text, L } = c;
  return functionFields(
    c,
    <>
      {text('x0', L('pointX'))}
      {text('h', L('stepH'))}
      <Choice
        label={L('derivative')}
        value={s.derivOrder as '1' | '2'}
        options={[
          { value: '1', label: L('first') },
          { value: '2', label: L('second') },
        ]}
        onChange={(derivOrder) => set({ derivOrder })}
      />
    </>,
  );
}

function quadForm(c: Ctx) {
  const { s, set, text, L } = c;
  return functionFields(
    c,
    <>
      <Choice
        label={L('method')}
        value={s.quad}
        options={options('quadMethod', [
          'left',
          'right',
          'midpoint',
          'trapezoid',
          'simpson',
          'romberg',
          'gauss',
        ] as const)}
        onChange={(quad) => set({ quad })}
      />
      {text('a', L('lower'))}
      {text('b', L('upper'))}
      {text('n', s.quad === 'gauss' ? L('points') : s.quad === 'romberg' ? L('levels') : L('panels'))}
    </>,
  );
}

function ivpForm(c: Ctx) {
  const { s, set, text, L } = c;
  return (
    <>
      <Choice
        label={L('method')}
        value={s.ivp}
        options={options('ivpMethod', ['euler', 'heun', 'rk4', 'rk45', 'backward-euler'] as const)}
        onChange={(ivp) => set({ ivp })}
      />
      {text('f', L('rhs'), { wide: true })}
      {text('t0', L('t0'))}
      {text('y0', L('y0'))}
      {text('tEnd', L('tEnd'))}
      {s.ivp === 'rk45' ? null : text('step', L('stepH'))}
      {text('exact', L('exactSolution'), { wide: true })}
    </>
  );
}

function bvpForm(c: Ctx) {
  const { s, set, text, L } = c;
  return (
    <>
      <Choice
        label={L('method')}
        value={s.bvp as 'difference' | 'shooting'}
        options={options('bvpMethod', ['difference', 'shooting'] as const)}
        onChange={(bvp) => set({ bvp })}
      />
      {text('bp', L('coefP'))}
      {text('bq', L('coefQ'))}
      {text('br', L('coefR'))}
      {text('ba', L('left'))}
      {text('bb', L('right'))}
      {text('alpha', L('valueLeft'))}
      {text('beta', L('valueRight'))}
      {text('bn', L('intervals'))}
      {text('bexact', L('exactSolutionX'), { wide: true })}
    </>
  );
}

function iterForm(c: Ctx) {
  const { s, set, text, L } = c;
  return (
    <>
      <Choice
        label={L('method')}
        value={s.iter}
        options={options('iterMethod', ['jacobi', 'gauss-seidel', 'sor'] as const)}
        onChange={(iter) => set({ iter })}
      />
      {s.iter === 'sor' ? text('omega', L('omega')) : null}
      {text('tol', L('tolerance'))}
      {text('maxIt', L('maxIterations'))}
      {text('A', L('matrix'), { wide: true, rows: 4 })}
      {text('rhs', L('rhsVector'))}
      {text('guess', L('guess'))}
    </>
  );
}

function newtonForm(c: Ctx) {
  const { text, L } = c;
  return (
    <>
      {text('unknowns', L('unknowns'))}
      {text('start', L('guess'))}
      {text('eqs', L('equations'), { wide: true, rows: 3 })}
    </>
  );
}

function gridForm(c: Ctx) {
  const { s, text, L } = c;
  return (
    <>
      {text('gn', L('gridPoints'))}
      {text('gw', L('width'))}
      {text('gh', L('height'))}
      {text('top', L('edgeTop'))}
      {text('bottom', L('edgeBottom'))}
      {text('left', L('edgeLeft'))}
      {text('right', L('edgeRight'))}
      {s.topic === 'poisson' ? (
        text('source', L('source'), { wide: true })
      ) : (
        <>
          {text('alpha2', L('diffusivity'))}
          {text('dt', L('timeStep'))}
          {text('tEnd2', L('endTime'))}
          {text('init2', L('initialTemperature'), { wide: true })}
        </>
      )}
    </>
  );
}

function fitForm(c: Ctx) {
  const { s, text, L } = c;
  return (
    <>
      {s.topic === 'polyfit' ? (
        text('degree', L('degree'))
      ) : (
        <>
          {text('model', L('model'), { wide: true })}
          {text('names', L('parameters'))}
          {text('fitStart', L('guess'))}
        </>
      )}
      {text('data', L('points'), { wide: true, rows: 5 })}
    </>
  );
}

function fftForm(c: Ctx) {
  const { text, L } = c;
  return (
    <>
      {text('rate', L('rate'))}
      {text('samples', L('samples'), { wide: true, rows: 3 })}
    </>
  );
}

export const FORMS: Record<Topic, (c: Ctx) => ReactNode> = {
  interp: interpForm,
  diff: diffForm,
  quad: quadForm,
  ivp: ivpForm,
  bvp: bvpForm,
  iter: iterForm,
  newton: newtonForm,
  poisson: gridForm,
  heat: gridForm,
  polyfit: fitForm,
  nlfit: fitForm,
  fft: fftForm,
};
