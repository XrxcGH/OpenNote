// Lines of math in a note: "Math with variables and units" (FEATURES.md, Phase 10) without any screen. Write
// `rent = 1,200` on one line and `rent * 12 =` on another, and the second line has its answer. Units work too, as in
// `5 mi in km =`. A line that is not math is left alone. The engine (core/expr/lines.ts) does the work. This file
// chooses the notes dialect: the calculator's grammar with units, a semicolon between function arguments, definitions,
// and functions of your own. Numbers follow the region, so 1,200.5 in one region is 1.200,5 in another.

import {
  BASE_LEX,
  evaluateLines,
  type AngleMode,
  type Dialect,
  type FormatOptions,
  type LineResult,
} from '../../../core/expr';
import { findConstant } from './constants';
import { CALCULATOR } from './dialect';
import { calculatorUnits, isUnitName } from './unitSystem';

/** The parts of a region that change how a note's numbers read, as the tables' Locale gives them. */
export interface NotesRegion {
  decimal: '.' | ',';
  /** The mark that groups digits. A space, or a mark the same as the decimal mark, groups nothing. */
  group: string;
}

/** A period for the decimal mark and a comma to group digits, as in en-US. */
export const DEFAULT_REGION: NotesRegion = { decimal: '.', group: ',' };

const dialects = new Map<string, Dialect>();

/** The notes dialect for a region. Built once per region. */
export function notesDialect(region: NotesRegion): Dialect {
  const key = `${region.decimal}${region.group}`;
  let dialect = dialects.get(key);
  if (dialect === undefined) {
    const group = region.group === region.decimal ? undefined : region.group;
    dialect = {
      ...CALCULATOR,
      lex: {
        ...CALCULATOR.lex,
        operators: [...BASE_LEX.operators, '=', '->'],
        aliases: { ...BASE_LEX.aliases, '→': '->' },
        decimal: region.decimal,
        // A comma groups digits (1,200) or is the decimal mark (2,5), so a semicolon separates arguments: max(1; 200).
        separators: ';',
        ...(group === ',' || group === '.' ? { thousands: group } : {}),
      },
      unknownCalls: 'call',
      definitions: true,
      units: { has: isUnitName },
    };
    dialects.set(key, dialect);
  }
  return dialect;
}

/** The notes dialect for the default region. */
export const NOTES: Dialect = notesDialect(DEFAULT_REGION);

export interface NotesOptions {
  /** The angle mode for sin and the degree sign. Default degrees, as in the calculator. */
  angle?: AngleMode;
  format?: FormatOptions;
  /** How numbers are written in the user's region. Default DEFAULT_REGION. */
  region?: NotesRegion;
}

/** Evaluates the lines of a page in order. The result has one entry per line. */
export function evaluateNotes(lines: readonly string[], options: NotesOptions = {}): LineResult[] {
  return evaluateLines(lines, {
    dialect: notesDialect(options.region ?? DEFAULT_REGION),
    units: calculatorUnits,
    constants: (name) => findConstant(name)?.value,
    angle: options.angle ?? 'deg',
    ...(options.format === undefined ? {} : { format: options.format }),
  });
}
