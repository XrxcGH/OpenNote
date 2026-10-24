// The fluid and heat transfer kit (the fluid and heat lane of the course tool kits): one window with a tab for each
// tool. The shared words come first, then each tool's group: its title and keywords, field labels, choices, result
// rows, assumptions, plot labels, and the wording of its worked steps (under step, named for the engine's step).
import { statics, staticsStep } from './kitFluidHeat/statics';
import { pipes, pipesStep } from './kitFluidHeat/pipes';
import { dimensional, dimensionalStep } from './kitFluidHeat/dimensional';
import { viscous, viscousStep } from './kitFluidHeat/viscous';
import { external, externalStep } from './kitFluidHeat/external';
import { conduction, conductionStep } from './kitFluidHeat/conduction';
import { fins, finsStep } from './kitFluidHeat/fins';
import { transient, transientStep } from './kitFluidHeat/transient';
import { convection, convectionStep } from './kitFluidHeat/convection';
import { hx, hxStep } from './kitFluidHeat/hx';
import { radiation, radiationStep } from './kitFluidHeat/radiation';
import { props, propsStep } from './kitFluidHeat/props';

export const kitFluidHeat = {
  title: 'Fluids and heat transfer',
  open: 'Open the fluid mechanics and heat transfer tools',
  keywords:
    'fluid mechanics heat transfer mass transfer pipe flow pump bernoulli drag convection ' +
    'conduction radiation exchanger fin',
  tabs: 'Fluid and heat transfer tools',
  loading: 'Loading the tool…',
  ui: {
    units: 'Units',
    si: 'SI (m, kPa, °C, W)',
    us: 'US customary (ft, psi, °F, Btu/h)',
    example: 'Example',
    exampleNone: 'Choose an example…',
    results: 'Results',
    steps: 'Worked steps',
    stepsSi: 'The numbers in the worked steps are in SI units: meters, pascals, kelvin, and watts.',
    assumptions: 'Assumptions',
    picture: 'Picture',
    quantity: 'Quantity',
    value: 'Value',
    insert: 'Insert',
    insertMenu: 'Insert into the page',
    insertAnswer: 'Answer line',
    insertEquation: 'Equation',
    insertTable: 'Result table',
    insertSteps: 'Worked steps',
    insertPicture: 'Picture',
    insertTables: 'Tables',
    inserted: 'Inserted into the page.',
    noPage: 'Click in a page first, then insert.',
    unitHint: 'A number alone is in {unit}. You can type another unit after it, such as 25 mm or 1 in.',
    fixFields: 'Fix the marked fields to see the results.',
  },
  error: {
    empty: 'Type a value.',
    unreadable: 'That could not be read: {detail}',
    unitMismatch: 'That unit measures something else. This field takes {other}, not {detail}.',
    positive: '{detail} must be greater than zero.',
    notNegative: '{detail} cannot be negative.',
    notFinite: '{detail} must be a number.',
    partsLine: 'Line {detail} could not be read. Check how many numbers it has and that each has the right unit.',
    calc: '{detail}',
    unknown: 'That could not be worked out.',
  },
  statics,
  pipes,
  dimensional,
  viscous,
  external,
  conduction,
  fins,
  transient,
  convection,
  hx,
  radiation,
  props,
  step: {
    ...staticsStep,
    ...pipesStep,
    ...dimensionalStep,
    ...viscousStep,
    ...externalStep,
    ...conductionStep,
    ...finsStep,
    ...transientStep,
    ...convectionStep,
    ...hxStep,
    ...radiationStep,
    ...propsStep,
  },
} as const;
