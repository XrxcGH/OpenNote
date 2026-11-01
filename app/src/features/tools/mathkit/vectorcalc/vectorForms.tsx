// The fields of each vector calculus operation, in the order a student works.
import '../text';
import type { ReactNode } from 'react';
import { Choice, say } from '../ui/parts';
import type { Operation, State } from './run';

export interface Ctx {
  s: State;
  set: (patch: Partial<State>) => void;
  show: (key: keyof State, label: string, wide?: boolean) => ReactNode;
  L: (name: string) => string;
}

function pick<T extends string>(
  group: string,
  value: T,
  values: readonly T[],
  label: string,
  onChange: (v: T) => void,
) {
  const options = values.map((v) => ({ value: v, label: say(`kitMath.vectorcalc.${group}.${v}`) }));
  return <Choice label={label} value={value} options={options} onChange={onChange} />;
}

const gradientForm = ({ show, L }: Ctx) => (
  <>
    {show('f', L('function'), true)}
    {show('point', L('point'))}
    {show('direction', L('direction'))}
  </>
);

const criticalForm = ({ show, L }: Ctx) => (
  <>
    {show('f', L('function'), true)}
    {show('window', L('window'))}
  </>
);

const lagrangeForm = ({ show, L }: Ctx) => (
  <>
    {show('f', L('function'), true)}
    {show('g', L('constraint'))}
    {show('c', L('constraintValue'))}
    {show('window', L('window'))}
  </>
);

const divcurlForm = ({ s, set, show, L }: Ctx) => (
  <>
    {pick('systemOption', s.system, ['cartesian', 'cylindrical', 'spherical'] as const, L('system'), (system) =>
      set({ system }),
    )}
    {show('field', L('vector'), true)}
    {show('point', L('point'))}
  </>
);

const jacobianForm = ({ show, L }: Ctx) => (
  <>
    {show('map', L('map'), true)}
    {show('vars', L('vars'))}
    {show('point', L('point'))}
  </>
);

const lineForm = ({ show, L }: Ctx) => (
  <>
    {show('field', L('vector'), true)}
    {show('curve', L('curve'), true)}
    {show('range', L('tRange'))}
  </>
);

const scalarLineForm = ({ show, L }: Ctx) => (
  <>
    {show('f', L('function'), true)}
    {show('curve', L('curve'), true)}
    {show('range', L('tRange'))}
  </>
);

const potentialForm = ({ show, L }: Ctx) => (
  <>
    {show('field', L('vector'), true)}
    {show('start', L('start'))}
    {show('end', L('end'))}
  </>
);

const greenForm = ({ s, set, show, L }: Ctx) => (
  <>
    {show('field', L('vector'), true)}
    {pick('regionOption', s.region, ['rect', 'disk', 'typeI'] as const, L('region'), (region) => set({ region }))}
    {s.region === 'rect' ? show('rect', L('rect')) : null}
    {s.region === 'disk' ? show('disk', L('disk')) : null}
    {s.region === 'typeI' ? (
      <>
        {show('lower', L('lower'))}
        {show('upper', L('upper'))}
        {show('xRange', L('xRange'))}
      </>
    ) : null}
  </>
);

const surfaceForm = ({ s, set, show, L }: Ctx) => (
  <>
    {pick('kindOption', s.surfaceKind, ['flux', 'scalar', 'area'] as const, L('kind'), (surfaceKind) =>
      set({ surfaceKind }),
    )}
    {s.surfaceKind === 'flux' ? show('field', L('vector'), true) : null}
    {s.surfaceKind === 'scalar' ? show('f', L('function'), true) : null}
    {show('surface', L('surface'), true)}
    {show('uv', L('uv'))}
  </>
);

const divergenceForm = ({ s, set, show, L }: Ctx) => (
  <>
    {show('field', L('vector'), true)}
    {pick('solidOption', s.solid, ['sphere', 'box'] as const, L('solid'), (solid) => set({ solid }))}
    {s.solid === 'sphere' ? show('radius', L('radius')) : show('box', L('box'))}
  </>
);

const stokesForm = ({ show, L }: Ctx) => (
  <>
    {show('field', L('vector'), true)}
    {show('surface', L('surface'), true)}
    {show('uv', L('uv'))}
  </>
);

export const FORMS: Record<Operation, (c: Ctx) => ReactNode> = {
  gradient: gradientForm,
  critical: criticalForm,
  lagrange: lagrangeForm,
  divcurl: divcurlForm,
  jacobian: jacobianForm,
  line: lineForm,
  linescalar: scalarLineForm,
  potential: potentialForm,
  green: greenForm,
  surface: surfaceForm,
  divergence: divergenceForm,
  stokes: stokesForm,
};
