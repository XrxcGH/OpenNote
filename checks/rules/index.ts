// The list of rules the CHECKS program runs. To add a rule, create a module in this folder that
// exports a Rule, then add it here, and document it in CHECKS.md.

import type { Rule } from '../types.ts';
import { aiMarkers } from './ai-markers.ts';
import { brandConsistency } from './brand-consistency.ts';
import { brandTokens } from './brand-tokens.ts';
import { grammar } from './grammar.ts';
import { hygiene } from './hygiene.ts';
import { layout } from './layout.ts';
import { length } from './length.ts';
import { modifiability } from './modifiability.ts';
import { readability } from './readability.ts';
import { redundancy } from './redundancy.ts';
import { spelling } from './spelling.ts';
import { usability } from './usability.ts';

export const RULES: Rule[] = [
  hygiene,
  spelling,
  grammar,
  aiMarkers,
  redundancy,
  length,
  readability,
  usability,
  modifiability,
  brandConsistency,
  brandTokens,
  layout,
];
