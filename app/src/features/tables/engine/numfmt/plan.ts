// The role of every token in a number section: integer, decimal, exponent, or fraction digits, a group or scaling
// comma, or a literal. Plans are kept per compiled section.

import type { Section, Token } from './types';

export type Digit = Extract<Token, { t: 'digit' }>;
export type Role = 'int' | 'dec' | 'exp' | 'num' | 'den' | 'whole' | 'group' | 'scale' | 'lit';

export interface Plan {
  roles: Role[];
  int: Digit[];
  dec: Digit[];
  exp: Digit[];
  num: Digit[];
  den: Digit[];
  whole: Digit[];
  fixedDen: number | null;
  grouping: boolean;
  scale: number;
  percent: number;
  fraction: boolean;
  scientific: boolean;
  general: boolean;
}

const plans = new WeakMap<Section, Plan>();

export function isDigit(t: Token | undefined): t is Digit {
  return t?.t === 'digit';
}

/** A fraction: the digits right before the slash are the numerator, earlier digits the whole part. */
function planFraction(tokens: readonly Token[], plan: Plan, slash: number): void {
  const { roles } = plan;
  plan.fraction = true;
  let i = slash - 1;
  while (isDigit(tokens[i])) roles[i--] = 'num';
  for (let j = i; j >= 0; j--) if (isDigit(tokens[j])) roles[j] = 'whole';
  const next = tokens[slash + 1];
  if (next.t === 'num') {
    roles[slash + 1] = 'den';
    plan.fixedDen = Number(next.s);
  } else for (let j = slash + 1; isDigit(tokens[j]); j++) roles[j] = 'den';
  tokens.forEach((t, k) => {
    if (!isDigit(t)) return;
    if (roles[k] === 'num') plan.num.push(t);
    else if (roles[k] === 'den') plan.den.push(t);
    else if (roles[k] === 'whole') plan.whole.push(t);
  });
}

/** A comma between integer digits groups them; commas right after the digits divide by 1,000 each. */
function commaRole(tokens: readonly Token[], roles: readonly Role[], i: number, intEnd: number): Role {
  const before = tokens.slice(0, i).some(isDigit);
  if (before && i < intEnd && tokens.slice(i + 1, intEnd).some(isDigit)) return 'group';
  if ((isDigit(tokens[i - 1]) || roles[i - 1] === 'scale') && !isDigit(tokens[i + 1])) return 'scale';
  return 'lit';
}

function planDecimal(tokens: readonly Token[], plan: Plan): void {
  const { roles } = plan;
  const expAt = tokens.findIndex((t) => t.t === 'exp');
  plan.scientific = expAt >= 0;
  const end = expAt >= 0 ? expAt : tokens.length;
  const pointAt = tokens.findIndex((t, i) => t.t === 'point' && i < end);
  const intEnd = pointAt >= 0 ? pointAt : end;
  tokens.forEach((t, i) => {
    if (isDigit(t)) {
      const role = i >= end ? 'exp' : i < intEnd ? 'int' : 'dec';
      roles[i] = role;
      plan[role].push(t);
    } else if (t.t === 'comma' && i < end) {
      roles[i] = commaRole(tokens, roles, i, intEnd);
      if (roles[i] === 'group') plan.grouping = true;
      if (roles[i] === 'scale') plan.scale++;
    }
  });
}

/** Gives every token of a number section its role. */
export function planOf(section: Section): Plan {
  const cached = plans.get(section);
  if (cached) return cached;
  const tokens = section.tokens;
  const plan: Plan = {
    roles: tokens.map(() => 'lit'),
    int: [],
    dec: [],
    exp: [],
    num: [],
    den: [],
    whole: [],
    fixedDen: null,
    grouping: false,
    scale: 0,
    percent: tokens.filter((t) => t.t === 'percent').length,
    fraction: false,
    scientific: false,
    general: tokens.some((t) => t.t === 'general'),
  };
  const slash = tokens.findIndex(
    (t, i) => t.t === 'slash' && isDigit(tokens[i - 1]) && (isDigit(tokens[i + 1]) || tokens[i + 1]?.t === 'num'),
  );
  if (slash >= 0) planFraction(tokens, plan, slash);
  else planDecimal(tokens, plan);
  plans.set(section, plan);
  return plan;
}
