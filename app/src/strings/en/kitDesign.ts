// The design kit (the design lane of the course tool kits): one window with a tab for each tool. The shared words are
// here. Each tool's group (its title and keywords, field labels, choices, result rows, assumptions, and plot labels)
// is in kitDesign/<tool>.ts, along with the wording of its worked steps and its error messages.
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
  },
  step: {
    ...tolerancesSteps,
  },
  tolerances,
} as const;
