// The aerospace kit window (flag kits.aero; owner: the aero lane). It holds the window's own words and the problems any
// tool can report; each tool's section (title, fields, result rows, plot labels, worked-step sentences, and its own
// problems) is in a file of its own under ./kitAero, all in this one namespace. Specs and engines look keys up by
// name, such as "r.T". Each namespace file has one owner, so parallel work never edits the same file.
import { atmosphere } from './kitAero/atmosphere';
import { compressible } from './kitAero/compressible';
import { nozzle } from './kitAero/nozzle';
import { rocket } from './kitAero/rocket';
import { wing } from './kitAero/wing';
import { performance } from './kitAero/performance';
import { potential } from './kitAero/potential';
import { flightmodes } from './kitAero/flightmodes';

export const kitAero = {
  window: 'Aerospace',
  tabs: 'Aerospace tools',
  open: 'Open the aerospace tools',
  openKeywords: 'aerospace aerodynamics gas dynamics propulsion flight mechanics compressible airfoil wing rocket jet',
  loading: 'Loading the tool…',
  units: 'Units',
  si: 'SI',
  us: 'US customary',
  unitOf: 'Unit of {name}',
  assumptions: 'Assumptions',
  results: 'Results',
  value: 'Value',
  steps: 'Worked steps',
  stepsNote: 'Steps are worked in SI units.',
  plots: 'Plots',
  plotLabel: '{title}: {y} against {x}.',
  source: 'Source: {source}',
  problem: 'Cannot calculate yet',
  insert: 'Insert into the page',
  insertAnswer: 'Answer line',
  insertEquation: 'Equation',
  insertTable: 'Result table',
  insertSteps: 'Steps as a list',
  insertPicture: 'Plot as picture',
  inserted: 'Inserted into the page.',
  noPage: 'Click in a page first, then insert.',
  error: {
    notNumber: 'Enter a number in “{name}”.',
    notPositive: '{name} must be greater than zero.',
    notNegative: '{name} cannot be negative.',
    gammaRange: 'γ = {value} is outside the range a gas can have. Use a value above 1 and at most 2 (air is 1.4).',
    noBracket: 'No solution was found in the searched range.',
    singular: 'The equations have no unique solution (the matrix is singular).',
    areaRatioBelowOne: 'A/A* cannot be less than 1: the throat is the smallest section of an isentropic flow.',
    efficiencyRange: '{name} must be greater than 0 and at most 1.',
  },
  t: {
    atmosphere,
    compressible,
    nozzle,
    rocket,
    wing,
    performance,
    potential,
    flightmodes,
  },
} as const;
