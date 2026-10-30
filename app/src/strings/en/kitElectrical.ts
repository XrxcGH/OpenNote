// The electrical tool kit: circuits, electronics, power, instruments, data fitting, and energy. Tool titles, field
// labels, row labels, worked-step sentences, and the problems an input can have. Courses are never named here.
import { e } from './kitElectrical/e';
import { f } from './kitElectrical/f';
import { n } from './kitElectrical/n';
import { r } from './kitElectrical/r';
import { s } from './kitElectrical/s';
import { t } from './kitElectrical/t';

// The sections (tools, fields, rows, steps, errors, notes) live in ./kitElectrical so no file grows too long.
export const kitElectrical = {
  window: 'Circuits and energy',
  tabs: 'Tools',
  open: 'Open the circuits and energy tools',
  openKeywords: 'electrical electronics circuit power energy instrument fit lab',
  insert: 'Insert',
  insertAnswer: 'Answer line',
  insertEquation: 'Equation',
  insertTable: 'Result table',
  insertSteps: 'Worked steps',
  insertPicture: 'Plot as picture',
  insertSecondPicture: 'Second plot as picture',
  insertCode: 'Code block',
  inserted: 'Inserted into the page.',
  noPage: 'Click in a page first, then insert.',
  assumptions: 'Assumptions',
  results: 'Results',
  steps: 'Worked steps',
  source: 'Source: {source}',
  plotLabel: 'Plot of {y} against {x}',
  plotAlt: 'Plot of {y} against {x}',
  loading: 'Loading the tool',
  t,
  f,
  r,
  s,
  e,
  n,
} as const;
