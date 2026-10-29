// checkSteps: reads each line and checks that it follows from the line before it. The first broken step is marked
// with why and a corrected line; a later step that follows correctly from a broken one says so. A line that cannot be
// read, or a step that cannot be decided, is 'unchecked'. Bounded: at most `maxLines` lines and `budgetMs` of work.
import {
  compareEquations,
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
import type { CheckOptions, StepLine, StepResult } from './types';
import { build } from '../../../core/expr';

const DEFAULT_SEED = 20261028;

type Relations = Extract<Statement, { kind: 'relations' }>;

const allEquations = (s: Relations) => s.groups.every((g) => g.every((atom) => atom.rel === '='));
const namesOf = (atoms: Atom[]) =>
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

  constructor(private readonly seed: number) {}

  step(text: string, index: number): Outcome {
    const statement = readLine(text, this.ctx);
    const seed = this.seed + index * 101;
    switch (statement.kind) {
      case 'blank':
        return outcome('ok', 'note', 'given', 1);
      case 'given':
        return outcome('ok', statement.reason, 'given', 1);
      case 'unreadable':
        return outcome('unchecked', statement.reason, 'none', 0);
      case 'values':
        return this.values(statement, seed);
      case 'relations':
        return this.relations(statement, seed);
    }
  }

  private noteIntegrals(parts: Value[]) {
    for (const part of parts) {
      if (part.kind === 'scalar' && part.integrals.length > 0) {
        this.chain = { anti: true, base: part.integrals[0].base };
      }
    }
  }

  private values(statement: Extract<Statement, { kind: 'values' }>, seed: number): Outcome {
    const { parts, continues } = statement;
    const links: Outcome[] = [];
    const linked = continues || parts.length === 1;
    if (!linked) this.chain = { anti: false, base: 'x' };
    this.noteIntegrals(parts);
    if (linked) {
      if (this.lastValue) links.push(compareValues(this.lastValue, parts[0], this.chain, seed));
      else if (continues) links.push(outcome('unchecked', 'unrelated', 'none', 0));
    }
    for (let j = 1; j < parts.length; j += 1) links.push(compareValues(parts[j - 1], parts[j], this.chain, seed + j));
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

  private relations(statement: Relations, seed: number): Outcome {
    const prev = this.prev;
    this.prev = statement;
    const single = statement.groups.length === 1 && statement.groups[0].length === 1;
    this.lastValue = single ? statement.groups[0][0].right : null;
    this.chain = { anti: false, base: 'x' };
    const equations = allEquations(statement);
    const isSystem = equations && statement.groups.length === 1 && statement.groups[0].length > 1;
    if (!prev) {
      if (isSystem && namesOf(statement.groups[0]).size > 1) this.facts = [...statement.groups[0]];
      return start();
    }
    if (equations && allEquations(prev)) {
      if (this.facts) {
        const found = compareWithSystem(this.facts, statement.groups, seed);
        if (found) {
          this.keepFacts(statement.groups[0], found);
          return found;
        }
      }
      const [a, b] = [equationOf(prev.groups), equationOf(statement.groups)];
      if (a && b) return compareEquations(a, b, statement.groups, seed);
      if (isSystem && namesOf(statement.groups[0]).size > 1) this.facts = [...statement.groups[0]];
      return outcome('unchecked', 'cannotDecide', 'none', 0);
    }
    this.facts = null;
    if (!equations && !allEquations(prev)) return compareInequalities(prev.groups, statement.groups, seed);
    if (!equations && allEquations(prev)) return start();
    return outcome('unchecked', 'unrelated', 'none', 0);
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

const lineText = (line: StepLine | string): string => {
  if (typeof line === 'string') return line;
  return line.format === 'latex' ? latexToLine(line.text) : line.text;
};

/**
 * Checks each line of worked math against the line before it. Returns one result per line, in order. Pure and
 * offline: no network, no clock in the answer (the time budget only stops work early), the same output for the same
 * input and seed. Never throws for any text.
 */
export function checkSteps(lines: readonly (StepLine | string)[], options: CheckOptions = {}): StepResult[] {
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
        found = checker.step(lineText(line).slice(0, 4000), index);
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
  return results;
}
