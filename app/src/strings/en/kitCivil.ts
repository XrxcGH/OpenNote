// The civil, environmental, and chemical engineering kit (owner: the civil lane). The window's own words are here;
// each tool's labels, results, and worked steps are in a file of their own under ./kitCivil, all in this namespace.
import { groundwater } from './kitCivil/groundwater';

export const kitCivil = {
  title: 'Civil and chemical engineering',
  common: {
    tool: 'Tool',
    calculation: 'Calculation',
    loading: 'Loading the calculations…',
    unitFor: 'Unit for {name}',
    columns: 'One row per line, with the columns {columns}.',
    optional: 'Optional',
    steps: 'Worked steps',
    results: 'Results',
    quantity: 'Quantity',
    value: 'Value',
    unit: 'Unit',
    source: 'Source: {source}',
    insertAnswer: 'Insert answer',
    insertMore: 'More ways to insert',
    insertSteps: 'Answer with worked steps',
    insertTable: 'Result table',
    insertLatex: 'Equation in LaTeX',
    insertGrid: 'Data table',
    insertPicture: 'Picture of the plot',
    inserted: 'Added to the page.',
    noPage: 'Click in a page first, then insert.',
    pictureFailed: 'The plot could not be made into a picture.',
    plotDescription: '{title}: {y} against {x}. Series: {series}.',
  },
  errors: {
    failed: 'This calculation could not finish with these numbers.',
    empty: 'Enter a value for {field}.',
    notNumber: '{field} needs a number, such as 2.5 or 1e-4.',
    row: 'Row {row} of {field} needs {count} numbers.',
    rows: '{field} needs at least {count} rows.',
    noRows: 'Add at least 1 row.',
    positive: '{name} must be greater than 0.',
    nonNegative: '{name} cannot be negative.',
    fraction: '{name} must be more than 0 and at most 1.',
    noRoot: 'No solution lies in the range searched. Check the inputs.',
    noConvergence: 'The calculation did not settle on an answer. Check the inputs.',
    singular: 'These equations have no single solution. Check that the inputs are independent.',
    fewPoints: 'At least {count} data points are needed.',
    sameX: 'The points all have the same x value, so no line fits them.',
  },
  tools: {
    groundwater: {
      title: 'Groundwater and wells',
      open: 'Open groundwater and wells',
      keywords:
        'groundwater hydrogeology aquifer darcy seepage velocity well drawdown theis cooper jacob hantush leaky ' +
        'pumping test transmissivity storativity image well capture zone flow net dam uplift contaminant ' +
        'transport ogata banks retardation dispersion',
    },
  },
  groundwater,
} as const;
