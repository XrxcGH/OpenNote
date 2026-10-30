// The design kit (the design lane of the course tool kits): one window with a tab for each tool. The shared words are
// here. Each tool's group (its title and keywords, field labels, choices, result rows, assumptions, and plot labels)
// is in kitDesign/<tool>.ts, along with the wording of its worked steps and its error messages.
import { errors } from './kitDesign/errors';
import { forming, formingSteps } from './kitDesign/forming';
import { machining, machiningSteps } from './kitDesign/machining';
import { microfab, microfabSteps } from './kitDesign/microfab';
import { numrep, numrepSteps } from './kitDesign/numrep';
import { drafting } from './kitDesign/drafting';
import { memtrace } from './kitDesign/memtrace';
import { views } from './kitDesign/views';
import { references } from './kitDesign/references';
import { tolerances, tolerancesErrors, tolerancesSteps } from './kitDesign/tolerances';

export const kitDesign = {
  title: 'Design tools',
  open: 'Open the design tools',
  keywords:
    'design drafting tolerance manufacturing machining forming casting fabrication number representation memory pointer',
  tabs: 'Design tools',
  loading: 'Loading the tool…',
  ui: {
    units: 'Units',
    si: 'SI (mm, N, MPa)',
    us: 'US customary (in, lbf, ksi)',
    unitFor: 'Unit for {field}',
    example: 'Example',
    exampleNone: 'Choose an example…',
    results: 'Results',
    steps: 'Worked steps',
    stepsUnits:
      'The steps use the formulas’ own units: millimeters, newtons, megapascals, and minutes unless a step says otherwise.',
    assumptions: 'Assumptions',
    quantity: 'Quantity',
    value: 'Value',
    insert: 'Insert',
    insertMenu: 'Insert into the page',
    insertAnswer: 'Answer line',
    insertEquation: 'Equation',
    insertTable: 'Result table',
    insertSteps: 'Worked steps',
    insertPicture: 'Picture',
    inserted: 'Inserted into the page.',
    noPage: 'Click in a page first, then insert.',
    fixFields: 'Fix the marked fields to see the results.',
  },
  error: {
    typeNumber: 'Type a number.',
    notNumber: 'That is not a number. Use digits, a decimal point, and e for a power of ten.',
    ...tolerancesErrors,
    ...errors,
  },
  step: {
    ...tolerancesSteps,
    ...machiningSteps,
    ...formingSteps,
    ...microfabSteps,
    ...numrepSteps,
  },
  paper: {
    computation: 'Computation paper',
    threeView: 'Three-view drawing paper',
    titleBlock: 'Title block',
    applied: '{name} applied.',
    noPage: 'Open a page first, then choose the paper.',
    title: 'Title',
    drawnBy: 'Drawn by',
    date: 'Date',
    scale: 'Scale',
    sheet: 'Sheet',
    material: 'Material',
    tolerance: 'Tolerances unless otherwise specified',
    front: 'Front',
    top: 'Top',
    right: 'Right',
    keywords: 'engineering paper drafting computation grid three view projection title block sheet',
  },
  tolerances,
  machining,
  forming,
  microfab,
  numrep,
  references,
  views,
  memtrace,
  drafting,
} as const;
