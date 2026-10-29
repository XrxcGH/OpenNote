// checkSteps: reads each line and checks that it follows from the line before it. The first broken step is marked
// with why and a corrected line; a later step that follows correctly from a broken one says so. A line that cannot be
// read, or a step that cannot be decided, is 'unchecked'. Bounded: at most `maxLines` lines and `budgetMs` of work.
import {
  compareEquations,
  sameEquation,
  signSlipOutcome,
  systemState,
  type Equation,
  compareInequalities,
  compareValues,
  compareWithSystem,
  consistent,
  equationOf,
  outcome,
  type ChainState,
  type Outcome,
} from './compare';
import { latexToLine } from './latex';
import { newContext, readLine, variables, type Atom, type Statement, type Value } from './read';
import { normalize, problemLead } from './text';
import type { CheckOptions, StepLine, StepResult } from './types';
import { build } from '../../../core/expr';

const DEFAULT_SEED = 20261028;

type Relations = Extract<Statement, { kind: 'relations' }>;

const allEquations = (s: Relations) => s.groups.every((g) => g.every((atom) => atom.rel === '='));
const namesOf = (atoms: Atom[]): Set<string> =>
  new Set(atoms.flatMap((atom) => variables(build.sub(atom.left.node, atom.right.node))));

/** The first broken link, else the first unchecked one, else the last one. */
function combine(links: Outcome[]): Outcome {
  return (
    links.find((o) => o.verdict === 'broken') ?? links.find((o) => o.verdict === 'unchecked') ?? links[links.length - 1]
  );
}

const start = () => outcome('ok', 'start', 'given', 1);

class Checker {
  private readonly ctx = newContext();
  private prev: Relations | null = null;
  private lastValue: Value | null = null;
  private chain: ChainState = { anti: false, base: 'x' };
  private facts: Atom[] | null = null;
  /** The line whose antiderivative had no + C, until a later line in its chain adds one. */
  private noConstant: number | null = null;
  /** Lines whose missing + C a later line added. */
  readonly constantAdded = new Set<number>();

  constructor(private readonly seed: number) {}

  /** A new problem: nothing above it is compared with what comes next. */
  private reset() {
    this.prev = null;
    this.lastValue = null;
    this.chain = { anti: false, base: 'x' };
    this.facts = null;
    this.noConstant = null;
  }

  step(text: string, index: number): Outcome {
    const lead = problemLead(normalize(text));
    if (lead.starts) this.reset();
    const statement = readLine(lead.rest, this.ctx);
    const seed = this.seed + index * 101;
    switch (statement.kind) {
      case 'blank':
        this.reset();
        return outcome('ok', 'note', 'given', 1);
      case 'given':
        return outcome('ok', statement.reason, 'given', 1);
      case 'unreadable':
        this.reset();
        return outcome('unchecked', statement.reason, 'none', 0);
      case 'values':
        return this.values(statement, seed, index);
      case 'relations':
        return this.relations(statement, seed, index);
    }
  }

  private noteIntegrals(parts: Value[]) {
    for (const part of parts) {
      if (part.kind === 'scalar' && part.integrals.length > 0) {
        this.chain = { anti: true, base: part.integrals[0].base };
      }
    }
  }

  /** Each value in a chain against the one before it, starting from `first` when there is one. */
  private chainLinks(first: Value | null, parts: Value[], seed: number, index: number): Outcome[] {
    const links: Outcome[] = [];
    if (first) links.push(compareValues(first, parts[0], this.chain, seed));
    for (let j = 1; j < parts.length; j += 1) links.push(compareValues(parts[j - 1], parts[j], this.chain, seed + j));
    if (links.some((o) => o.reason === 'missingConstant')) this.noConstant = index;
    else if (this.noConstant !== null && this.chain.anti && links.length > 0 && hasConstant(parts[parts.length - 1])) {
      this.constantAdded.add(this.noConstant);
      this.noConstant = null;
    }
    return links;
  }

  private values(statement: Extract<Statement, { kind: 'values' }>, seed: number, index: number): Outcome {
    const { parts, continues } = statement;
    const linked = continues || parts.length === 1;
    if (!linked) {
      this.chain = { anti: false, base: 'x' };
      this.noConstant = null;
    }
    // A new expression with letters after plain numbers, or with none of the letters before it: a new problem.
    if (linked && !continues && this.lastValue && unrelated(this.lastValue, parts[0])) this.reset();
    this.noteIntegrals(parts);
    const links: Outcome[] = [];
    let first: Value | null = null;
    if (linked) {
      if (this.lastValue && continues && unrelated(this.lastValue, parts[0])) {
        links.push(outcome('unchecked', 'cannotEvaluate', 'none', 0));
      } else if (this.lastValue) first = this.lastValue;
      else if (continues) links.push(outcome('unchecked', 'unrelated', 'none', 0));
    }
    links.push(...this.chainLinks(first, parts, seed, index));
    this.lastValue = parts[parts.length - 1];
    this.prev = null;
    this.facts = null;
    // Meters plus kilograms, or matrices whose sizes do not fit, are wrong wherever they are in the line.
    const invalid = parts.find((part) => part.kind === 'invalid');
    if (invalid && invalid.kind === 'invalid') {
      return outcome('broken', invalid.reason, invalid.reason === 'matrixShape' ? 'matrix' : 'units', 0.99);
    }
    return links.length > 0 ? combine(links) : start();
  }

  private relations(statement: Relations, seed: number, index: number): Outcome {
    const cur = namesOfGroups(statement.groups);
    const before = new Set([...(this.prev ? namesOfGroups(this.prev.groups) : []), ...namesOf(this.facts ?? [])]);
    // 3y = 9 after x = 2: none of the same letters, so a new problem.
    if (this.prev && cur.size > 0 && before.size > 0 && ![...cur].some((name) => before.has(name))) this.reset();
    const found = this.relationStep(statement, cur, seed);
    const { tail } = statement;
    if (!tail) return found;
    this.chain = { anti: false, base: 'x' };
    this.lastValue = tail[tail.length - 1];
    const links = tail.length > 1 ? this.chainLinks(tail[0], tail.slice(1), seed + 7, index) : [];
    return links.length > 0 ? combine([found, ...links]) : found;
  }

  private relationStep(statement: Relations, cur: Set<string>, seed: number): Outcome {
    const prev = this.prev;
    this.prev = statement;
    const single = statement.groups.length === 1 && statement.groups[0].length === 1;
    this.lastValue = single ? statement.groups[0][0].right : null;
    this.chain = { anti: false, base: 'x' };
    const equations = allEquations(statement);
    const isSystem = equations && statement.groups.length === 1 && statement.groups[0].length > 1;
    if (!prev) {
      if (isSystem && cur.size > 1) this.facts = [...statement.groups[0]];
      return start();
    }
    if (equations && allEquations(prev)) {
      const known = this.facts ? namesOf(this.facts) : null;
      if (this.facts && known && [...cur].every((name) => known.has(name))) {
        const found = compareWithSystem(this.facts, statement.groups, seed);
        if (found) {
          this.keepFacts(statement.groups[0], found);
          return found;
        }
      }
      const [a, b] = [equationOf(prev.groups), equationOf(statement.groups)];
      const prevNames = namesOfGroups(prev.groups);
      const oneUnknown = cur.size === 1 && prevNames.size === 1 && [...cur][0] === [...prevNames][0];
      if (a && b && (oneUnknown || sameEquation(a, b, seed))) return compareEquations(a, b, statement.groups, seed);
      return this.system(prev, statement, [a, b], cur, seed);
    }
    this.facts = null;
    if (!equations && !allEquations(prev)) return compareInequalities(prev.groups, statement.groups, seed);
    if (!equations && allEquations(prev)) return start();
    return outcome('unchecked', 'unrelated', 'none', 0);
  }

  /**
   * Equations in more than one unknown, written one to a line: y = 3x, then x + y = 8. A new equation that fits with
   * the ones above joins them, and the lines after are checked at their solution. Only a sign slip, or an equation
   * that cannot hold with the one before, is broken.
   */
  private system(
    prev: Relations,
    statement: Relations,
    [a, b]: [Equation | null, Equation | null],
    cur: Set<string>,
    seed: number,
  ): Outcome {
    const base = this.facts ?? (prev.groups.length === 1 ? prev.groups[0] : null);
    const atoms = statement.groups.length === 1 ? statement.groups[0] : null;
    if (!base || !atoms) return outcome('unchecked', 'cannotDecide', 'none', 0);
    const names = namesOf(base);
    const adds = [...cur].some((name) => !names.has(name));
    const drops = [...names].some((name) => !cur.has(name));
    if (a && atoms.length === 1 && !adds && !drops) {
      const slip = signSlipOutcome(a, atoms[0], seed);
      if (slip) return slip;
    }
    const all = [...base, ...atoms];
    const state = systemState(all, this.seed);
    if (state === 'consistent' && (adds || !drops)) {
      this.facts = all;
      return outcome('ok', 'systemEquation', 'given', 1);
    }
    // The same unknowns, and no point satisfies both: 2x + y = 7, then 2x + y = 9.
    if (state === 'inconsistent' && !adds && !drops && a && b) return compareEquations(a, b, statement.groups, seed);
    // A formula rearranged: v = u + at, then u = v - at.
    const curved = systemState(base, this.seed) === null && systemState(atoms, this.seed) === null;
    if (state === null && !adds && !drops && a && b && curved && base.length === 1) {
      return compareEquations(a, b, statement.groups, seed);
    }
    this.facts = null;
    return outcome('unchecked', 'cannotDecide', 'none', 0);
  }

  /** After a step in a system, its equations join the others; after a broken one, only those that still agree. */
  private keepFacts(atoms: Atom[], found: Outcome) {
    if (!this.facts) return;
    if (found.verdict === 'ok') {
      this.facts = [...this.facts, ...atoms];
      return;
    }
    const kept = [...atoms];
    for (const atom of this.facts) if (consistent([...kept, atom], this.seed)) kept.push(atom);
    this.facts = kept;
  }
}

const namesOfGroups = (groups: Atom[][]) => namesOf(groups.flat());

const CONSTANT_NAMES = new Set(['C', 'c', 'K', 'k']);

/** True when a value has a constant of integration, such as + C. */
export function hasConstant(value: Value): boolean {
  return value.kind === 'scalar' && variables(value.node).some((name) => CONSTANT_NAMES.has(name));
}

/** Plain numbers before and letters now, or two sets of letters with none in common. */
function unrelated(earlier: Value, next: Value): boolean {
  if (earlier.kind !== 'scalar' || next.kind !== 'scalar') return false;
  if (earlier.integrals.length > 0 || next.integrals.length > 0) return false;
  const [was, now] = [variables(earlier.node), variables(next.node)];
  if (now.length === 0) return false;
  return was.length === 0 || !now.some((name) => was.includes(name));
}

const lineText = (line: StepLine | string): string => {
  if (typeof line === 'string') return line;
  if (!line || typeof line.text !== 'string') return '';
  return line.format === 'latex' ? latexToLine(line.text) : line.text;
};

/**
 * Checks each line of worked math against the line before it. Returns one result per line, in order. Pure and
 * offline: no network, no clock in the answer (the time budget only stops work early), the same output for the same
 * input and seed. Never throws for any text.
 */
export function checkSteps(input: readonly (StepLine | string)[], options: CheckOptions = {}): StepResult[] {
  // The AI tutor passes what a model wrote: a lone string or nothing is read as one line or none, never a throw.
  const lines: readonly unknown[] = Array.isArray(input) ? input : input == null ? [] : [input];
  const seed = options.seed ?? DEFAULT_SEED;
  const maxLines = options.maxLines ?? 200;
  const budget = options.budgetMs ?? 4000;
  const began = Date.now();
  const checker = new Checker(seed);
  const results: StepResult[] = [];
  let broken = false;
  lines.forEach((line, index) => {
    let found: Outcome;
    if (index >= maxLines || Date.now() - began > budget) found = outcome('unchecked', 'tooLong', 'none', 0);
    else {
      try {
        found = checker.step(lineText(line as StepLine | string).slice(0, 4000), index);
      } catch {
        found = outcome('unchecked', 'cannotDecide', 'none', 0);
      }
    }
    if (found.verdict === 'broken') broken = true;
    else if (broken && found.verdict === 'ok' && found.method !== 'given') {
      found = { ...found, reason: 'followsPrevious' };
    }
    results.push({ index, ...found, params: { ...found.params } });
  });
  // An antiderivative with no + C is fine when a later line adds it.
  return results.map((r) =>
    checker.constantAdded.has(r.index) && r.reason === 'missingConstant'
      ? {
          index: r.index,
          verdict: r.verdict,
          reason: 'antiderivative',
          params: {},
          method: r.method,
          confidence: r.confidence,
        }
      : r,
  );
}
