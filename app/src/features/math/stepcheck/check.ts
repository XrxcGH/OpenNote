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
  fn,
  numberText,
  outcome,
  rootOf,
  rootsOf,
  solutionsOf,
  solves,
  someValues,
  type ChainState,
  type Outcome,
} from './compare';
import {
  COEFFICIENTS,
  DERIVATIVE_LABEL,
  type Formula,
  HAS_DERIVATIVE,
  boundText,
  derivativeChain,
  factoringSlip,
  fitsLine,
  isFormula,
  limitBodies,
  putInAll,
  sameNumber,
  spreadOver,
} from './forms';
import { latexToLine } from './latex';
import { newContext, readLine, variables, type Atom, type Scalar, type Statement, type Value } from './read';
import { normalize, problemLead, splitSteps } from './text';
import type { CheckOptions, StepLine, StepResult } from './types';
import { build, type Node } from '../../../core/expr';
import { substitute } from '../calculus/algebra';

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
  /** True when lastValue is an equation's side: a line after it starts a new chain unless it starts with =. */
  private fromRelation = false;
  /** Letters fixed by a line such as x = 3 in this problem, for a check of the answer on the lines after it. */
  private readonly known = new Map<string, Node>();
  /**
   * After x^2 = 16, then x = 4: the equation whose solutions are being listed one to a line, the letter, the values
   * listed so far, and the first line, which is unchecked until the list covers every solution.
   */
  private roots: Roots | null = null;
  /** First lines of a list of solutions that the lines after it completed. */
  readonly rootsListed = new Set<number>();
  private chain: ChainState = { anti: false, base: 'x' };
  private facts: Atom[] | null = null;
  /** The line whose antiderivative had no + C, until a later line in its chain adds one. */
  private noConstant: number | null = null;
  /** Lines whose missing + C a later line added. */
  readonly constantAdded = new Set<number>();

  /**
   * A = πr^2, then r = 2: the formula, and the values given for some of its letters on the lines after it. The next
   * line in the formula's letters is checked against the formula with those values put in.
   */
  private formula: Formula | null = null;

  /** y' = 2x: the derivative's name and what it was worked out to, for a y' = 0 on the line after. */
  private label: { name: string; right: string } | null = null;

  /** Where earlier lines of this problem have no value: denominators, and what ln and sqrt are taken of. */
  private guards: Guard[] = [];

  constructor(private readonly seed: number) {}

  /**
   * x = 1 after (x^2 - 1)/(x - 1) = 2 and x + 1 = 2: the step follows, but its solution is one the first line does not
   * allow. Unchecked, with that value, rather than a tick on an answer that is not one.
   */
  private outside(statement: Relations, seed: number): Outcome | null {
    if (this.guards.length === 0) return null;
    const eq = equationOf(statement.groups);
    if (!eq || eq.names.length !== 1) return null;
    const [name] = eq.names;
    const bad = solutionsOf(eq, seed).find((v) => this.guards.some((g) => undefinedAt(g, name, v)));
    if (bad === undefined) return null;
    return outcome('unchecked', 'outsideDomain', 'solutions', 0.9, { at: `${name} = ${numberText(tidy(bad))}` });
  }

  /** A new problem: nothing above it is compared with what comes next. */
  private reset() {
    this.prev = null;
    this.lastValue = null;
    this.fromRelation = false;
    this.known.clear();
    this.roots = null;
    this.chain = { anti: false, base: 'x' };
    this.facts = null;
    this.noConstant = null;
    this.guards = [];
    this.formula = null;
    this.label = null;
  }

  /**
   * A = πr^2, then r = 2 (or u = 0, a = 2, t = 5 after v = u + at): values for some of the formula's letters, given
   * rather than worked out. Null when the line is not that, or gives every letter the formula has left: the answer.
   */
  private givenValues(statement: Relations, roots: { name: string; value: Node }[]): Outcome | null {
    const prev = this.prev;
    if (!prev || this.facts) return null;
    // v = 0 + 2 × 5 after v = u + at puts values in; it gives none.
    if (isFormula(prev) && fitsLine(prev, statement, new Map())) return null;
    const formula = this.formula ?? (isFormula(prev) ? { statement: prev, values: new Map<string, Node>() } : null);
    if (!formula || formula.statement !== prev) return null;
    const open = [...namesOfGroups(prev.groups)].filter((name) => !formula.values.has(name));
    if (!roots.every((root) => open.includes(root.name)) || roots.length >= open.length) return null;
    for (const root of roots) formula.values.set(root.name, root.value);
    this.formula = formula;
    this.lastValue = null;
    this.fromRelation = true;
    return outcome('ok', 'givenValue', 'given', 1, { at: boundText(new Map(roots.map((r) => [r.name, r.value]))) });
  }

  /** The line after A = πr^2 and r = 2, checked against A = π(2)^2. Null when it is not an equation in those letters. */
  private withValues(formula: Formula, statement: Relations, seed: number): Outcome | null {
    const values = [...formula.values];
    const put = (side: Scalar): Scalar => ({
      ...side,
      node: values.reduce((n, [name, value]) => substitute(n, name, value), side.node),
      alt: undefined,
    });
    const [atom] = formula.statement.groups[0];
    const a = equationOf([[{ ...atom, left: put(atom.left), right: put(atom.right) }]]);
    const b = equationOf(statement.groups);
    if (!a || !b || !b.names.every((name) => a.names.includes(name))) return null;
    const found = compareEquations(a, b, statement.groups, seed);
    if (found.verdict !== 'ok') return found;
    return outcome('ok', 'knownValue', found.method, found.confidence, { at: boundText(formula.values) });
  }

  /**
   * v = 0 + 2 × 5 after v = u + at: the line before with numbers put in for some of its letters. Nothing to check
   * yet, and the values are kept for the lines after. Null when the line is not that.
   */
  private valuesPutIn(prev: Relations, statement: Relations, cur: Set<string>): Outcome | null {
    if (!isFormula(prev) || statement.groups.length !== 1 || statement.groups[0].length !== 1) return null;
    const had = namesOfGroups(prev.groups);
    if (cur.size === 0 || cur.size >= had.size || ![...cur].every((name) => had.has(name))) return null;
    const bound = new Map<string, Node>();
    if (!fitsLine(prev, statement, bound) || bound.size === 0) return null;
    const clash = [...bound].some(([name, value]) => {
      const known = this.known.get(name);
      return known !== undefined && !sameNumber(fn(known)({}), fn(value)({}));
    });
    if (clash) return null;
    for (const [name, value] of bound) this.known.set(name, value);
    return outcome('ok', 'valuesPutIn', 'given', 1, { at: boundText(bound) });
  }

  step(text: string, index: number): Outcome {
    const lead = problemLead(normalize(text));
    if (lead.starts) this.reset();
    // 2x + 3 = 7 → 2x = 4 → x = 2: each part a step after the one before, and the line's mark the first slip in it.
    const parts = splitSteps(lead.rest).flatMap(derivativeChain);
    if (parts.length === 1) return this.part(lead.rest, this.seed + index * 101, index);
    return combine(parts.map((part, k) => this.part(part, this.seed + index * 101 + k * 13, index)));
  }

  private part(text: string, seed: number, index: number): Outcome {
    const set = this.setToValue(text);
    if (set) return this.relations(set, seed, index);
    const statement = readLine(text, this.ctx);
    switch (statement.kind) {
      case 'blank':
        this.reset();
        return outcome('ok', 'note', 'given', 1);
      case 'given':
        for (const [name, value] of statement.values ?? []) this.known.set(name, value);
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

  /**
   * y' = 0 after y' = 2x: the derivative set to a value, so the line is the equation 2x = 0 to solve, and a new chain
   * starts from it. Null for any other line; a derivative label is kept for the line after.
   */
  private setToValue(text: string): Relations | null {
    const before = this.label;
    this.label = null;
    const found = DERIVATIVE_LABEL.exec(text.trim());
    if (!found || /[=<>≤≥≠]/.test(found[2])) return null;
    const [name, right] = [found[1].replace(/\s+/g, ''), found[2].trim()];
    this.label = { name, right };
    if (!before || before.name !== name || HAS_DERIVATIVE.test(right)) return null;
    const statement = readLine(`${before.right} = ${right}`, this.ctx);
    if (statement.kind !== 'relations') return null;
    this.label = before;
    this.prev = null;
    this.lastValue = null;
    this.fromRelation = false;
    this.roots = null;
    this.facts = null;
    this.formula = null;
    return statement;
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
    if (first) links.push(this.link(first, parts[0], seed));
    for (let j = 1; j < parts.length; j += 1) links.push(this.link(parts[j - 1], parts[j], seed + j));
    if (links.some((o) => o.reason === 'missingConstant')) this.noConstant = index;
    else if (this.noConstant !== null && this.chain.anti && links.length > 0 && hasConstant(parts[parts.length - 1])) {
      this.constantAdded.add(this.noConstant);
      this.noConstant = null;
    }
    return links;
  }

  /**
   * Two values in a chain. When they differ as expressions but use letters fixed above (2x, then = 6, after x = 3),
   * they are compared again with those values put in.
   */
  private link(a: Value, b: Value, seed: number): Outcome {
    const inside = limitBodies(a, b, this.chain, seed);
    if (inside) return inside;
    const found = compareValues(a, b, this.chain, seed);
    if (found.verdict === 'ok' || this.chain.anti) return found;
    if (a.kind !== 'scalar' || b.kind !== 'scalar' || a.integrals.length + b.integrals.length > 0) return found;
    const used = [...new Set([...variables(a.node), ...variables(b.node)])].filter((name) => this.known.has(name));
    const known = (name: string) => this.known.get(name) ?? build.num(0);
    const put = (node: Node) => used.reduce((n, name) => substitute(n, name, known(name)), node);
    const [na, nb] = [put(a.node), put(b.node)];
    if (used.length > 0 && variables(na).length + variables(nb).length === 0) {
      const again = compareValues({ ...a, node: na }, { ...b, node: nb }, this.chain, seed);
      if (again.verdict !== 'ok') return again;
      const at = used.map((name) => `${name} = ${numberText(fn(known(name))({}))}`).join(', ');
      return outcome('ok', 'knownValue', 'evaluation', again.confidence, { at });
    }
    if (variables(nb).length === 0 && variables(na).length > 0) {
      // 3x^2 + 2x, then = 3(2)^2 + 2(2): a number put in for each letter, so the lines after work out its value.
      const bound = putInAll(na, nb);
      if (bound) return outcome('ok', 'valuesPutIn', 'given', 1, { at: boundText(bound) });
      // y = 2x + 3, then = 7, with no x given: true for some x, so not a slip that can be shown.
      if (found.verdict === 'broken') return someValues({ ...a, node: na }, { ...b, node: nb }, seed) ?? found;
    }
    return found;
  }

  private values(statement: Extract<Statement, { kind: 'values' }>, seed: number, index: number): Outcome {
    const { parts, continues } = statement;
    // 3(5) - 4 after x = 5 checks the answer: a new chain, not the next value after 5.
    const linked = continues || (parts.length === 1 && !this.fromRelation);
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
    this.fromRelation = false;
    this.roots = null;
    this.prev = null;
    this.facts = null;
    // Meters plus kilograms, or matrices whose sizes do not fit, are wrong wherever they are in the line.
    const invalid = parts.find((part) => part.kind === 'invalid');
    if (invalid && invalid.kind === 'invalid') {
      return outcome('broken', invalid.reason, invalid.reason === 'matrixShape' ? 'matrix' : 'units', 0.99);
    }
    return links.length > 0 ? combine(links) : start();
  }

  private relations(read: Relations, seed: number, index: number): Outcome {
    let statement = read;
    const cur = namesOfGroups(statement.groups);
    const before = new Set([...(this.prev ? namesOfGroups(this.prev.groups) : []), ...namesOf(this.facts ?? [])]);
    const roots = rootsOf(statement.groups);
    const formula = this.quadraticFormula(statement, cur, roots);
    if (formula && 'verdict' in formula) return formula;
    if (formula) statement = formula;
    // 3y = 9 after x = 2: none of the same letters, so a new problem. But y = 3 after x = 2 gives another value for
    // the check below them (x + y = 5), so the values given so far are kept.
    if (this.prev && cur.size > 0 && before.size > 0 && ![...cur].some((name) => before.has(name))) {
      const kept = roots ? new Map(this.known) : null;
      this.reset();
      for (const [name, value] of kept ?? []) this.known.set(name, value);
    }
    const given = roots ? this.givenValues(statement, roots) : null;
    if (given) {
      for (const root of roots ?? []) this.known.set(root.name, root.value);
      return given;
    }
    const prev = this.prev;
    const step = this.relationStep(statement, cur, seed, index);
    const found = step.verdict === 'broken' ? otherWay(prev, statement, step, seed) : step;
    for (const root of roots ?? []) this.known.set(root.name, root.value);
    const outside = found.verdict === 'ok' && found.method !== 'given' ? this.outside(statement, seed) : null;
    for (const atom of statement.groups.flat())
      this.guards.push(...guardsOf(atom.left.node), ...guardsOf(atom.right.node));
    if (outside) return outside;
    const { tail } = statement;
    if (!tail) return found;
    this.chain = { anti: false, base: 'x' };
    this.lastValue = tail[tail.length - 1];
    this.fromRelation = true;
    const links = tail.length > 1 ? this.chainLinks(tail[0], tail.slice(1), seed + 7, index) : [];
    return links.length > 0 ? combine([found, ...links]) : found;
  }

  private relationStep(statement: Relations, cur: Set<string>, seed: number, index: number): Outcome {
    const prev = this.prev;
    const formula = this.formula;
    this.formula = null;
    this.prev = statement;
    const single = statement.groups.length === 1 && statement.groups[0].length === 1;
    this.lastValue = single ? statement.groups[0][0].right : null;
    this.fromRelation = true;
    const roots = this.roots;
    this.roots = null;
    this.chain = { anti: false, base: 'x' };
    const equations = allEquations(statement);
    const isSystem = equations && statement.groups.length === 1 && statement.groups[0].length > 1;
    if (!prev) {
      if (isSystem && cur.size > 1) this.facts = [...statement.groups[0]];
      return this.firstClaim(statement, seed) ?? start();
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
      const withValues = formula && formula.statement === prev ? this.withValues(formula, statement, seed) : null;
      if (withValues) return withValues;
      const putIn = this.valuesPutIn(prev, statement, cur);
      if (putIn) return putIn;
      const [a, b] = [equationOf(prev.groups), equationOf(statement.groups)];
      const listed = roots && b ? this.nextRoot(roots, statement, b, seed) : null;
      if (listed) return listed;
      const prevNames = namesOfGroups(prev.groups);
      const oneUnknown = cur.size === 1 && prevNames.size === 1 && [...cur][0] === [...prevNames][0];
      if (a && b && (oneUnknown || sameEquation(a, b, seed))) {
        const found = compareEquations(a, b, statement.groups, seed);
        const slip = found.verdict === 'ok' ? null : factoringSlip(prev, statement, a, seed);
        if (slip) return slip;
        if (found.reason === 'lostSolutions') this.startRoots(a, statement, index, seed);
        return found;
      }
      return this.system(prev, statement, [a, b], cur, seed);
    }
    this.facts = null;
    if (!equations && !allEquations(prev)) return compareInequalities(prev.groups, statement.groups, seed);
    if (!equations && allEquations(prev)) return start();
    return outcome('unchecked', 'unrelated', 'none', 0);
  }

  /**
   * sin(a + b) = sin(a) + sin(b) or (x + y)^2 = x^2 + y^2 on a first line: a function or power spread over a sum,
   * a claim that holds for every value or not at all. 2(x - 3) = 2x - 3: sides a fixed amount apart, never equal.
   * Null for a line that may be an equation to solve, such as x^2 = 2x.
   */
  private firstClaim(statement: Relations, seed: number): Outcome | null {
    if (statement.groups.length !== 1 || statement.groups[0].length !== 1) return null;
    const [{ left, rel, right }] = statement.groups[0];
    if (rel !== '=' || left.integrals.length + right.integrals.length > 0) return null;
    if (variables(left.node).length === 0 || variables(right.node).length === 0) return null;
    const found = compareValues(left, right, this.chain, seed);
    if (found.reason === 'constantOff')
      return outcome('unchecked', 'neverEqual', 'numeric', 0.9, {
        offset: String(found.params.offset).replace(/^-/, ''),
      });
    if (!spreadOver(left.node, right.node) && !spreadOver(right.node, left.node)) return null;
    if (found.verdict === 'broken') return { ...found, suggestion: undefined };
    return found.verdict === 'unchecked' ? outcome('unchecked', 'cannotDecide', 'none', 0) : null;
  }

  /**
   * The quadratic formula's letters after x^2 - 3x + 2 = 0. A line such as a = 1, b = -3, c = 2 gives them, and the
   * equation stays the one later lines are checked against. The formula with letters is a note until all three are
   * given, and after that the line with them put in. Null for other lines.
   */
  private quadraticFormula(
    statement: Relations,
    cur: Set<string>,
    roots: { name: string; value: Node }[] | null,
  ): Outcome | Relations | null {
    const prev = this.prev;
    const names = prev ? [...namesOfGroups(prev.groups)] : [];
    if (!prev || names.length !== 1 || COEFFICIENTS.has(names[0]) || !equationOf(prev.groups)) return null;
    const x = names[0];
    const letters = [...cur].filter((name) => COEFFICIENTS.has(name));
    if (![...cur].every((name) => name === x || COEFFICIENTS.has(name))) return null;
    if (roots && !cur.has(x) && letters.length >= 2) {
      for (const root of roots) this.known.set(root.name, root.value);
      return outcome('ok', 'coefficients', 'given', 1, { at: boundText(new Map(roots.map((r) => [r.name, r.value]))) });
    }
    if (!cur.has(x) || letters.length < 3) return null;
    if (!letters.every((name) => this.known.has(name))) return outcome('ok', 'note', 'given', 1);
    const put = (side: Scalar): Scalar => ({
      ...side,
      node: letters.reduce((n, name) => substitute(n, name, this.known.get(name) ?? build.num(0)), side.node),
      alt: undefined,
    });
    const groups = statement.groups.map((g) =>
      g.map((atom) => ({ ...atom, left: put(atom.left), right: put(atom.right) })),
    );
    return { ...statement, groups };
  }

  /** x = 2 after (x - 2)(x - 3) = 0: one solution, and the next lines may list the others. */
  private startRoots(eq: Equation, statement: Relations, index: number, seed: number) {
    const root = rootOf(statement.groups);
    if (!root || eq.names.length !== 1 || eq.names[0] !== root.name) return;
    const all = solutionsOf(eq, seed);
    if (all.length > 1) this.roots = { eq, name: root.name, all, listed: [fn(root.value)({})], first: index };
  }

  /**
   * x = 3 after x = 2, when x = 2 was one solution of the equation above it: checked against that equation. A value
   * that solves it is right; once every solution is listed, the first line of the list is right too. Null when the
   * line is not the next value in the list.
   */
  private nextRoot(roots: Roots, statement: Relations, b: Equation, seed: number): Outcome | null {
    const root = rootOf(statement.groups);
    if (!root || root.name !== roots.name) return null;
    const value = fn(root.value)({});
    // A value that solves neither: broken, with the solutions of the equation in the suggestion.
    if (!solves(roots.eq, root.name, value)) return compareEquations(roots.eq, b, statement.groups, seed);
    const listed = [...roots.listed, value];
    this.roots = { ...roots, listed };
    const near = (r: number) => listed.some((v) => Math.abs(v - r) <= 1e-6 * Math.max(1, Math.abs(r)));
    if (roots.all.every(near)) this.rootsListed.add(roots.first);
    return outcome('ok', 'oneRoot', 'solutions', 0.95);
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
    // y - 3 = 2x, then x = y - 3/2: one equation rearranged for x, not a second equation of a system. Checked as a
    // rearrangement, and only shown as a slip when it uses the same numbers; else unchecked, though it still joins.
    const isolated = isolates(atoms[0]);
    const rearranged = !this.facts && base.length === 1 && atoms.length === 1 && !adds && !drops && isolated;
    if (rearranged && a && b) {
      const found = compareEquations(a, b, statement.groups, seed);
      if (found.verdict === 'ok') return found;
      if (found.verdict === 'broken' && sameNumbers(base[0], atoms[0])) return found;
    }
    const all = [...base, ...atoms];
    const state = systemState(all, this.seed);
    if (rearranged && state === 'consistent') {
      this.facts = all;
      return outcome('unchecked', 'cannotDecide', 'none', 0);
    }
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

interface Roots {
  eq: Equation;
  name: string;
  all: number[];
  listed: number[];
  first: number;
}

const namesOfGroups = (groups: Atom[][]) => namesOf(groups.flat());

interface Guard {
  node: Node;
  /** Zero is not allowed (a denominator), or below zero (sqrt), or zero and below (ln, log). */
  kind: 'zero' | 'negative' | 'notPositive';
}

/** The parts of a node that must keep away from zero or stay positive for it to have a value. */
function guardsOf(node: Node, out: Guard[] = []): Guard[] {
  if (node.type === 'binary') {
    if (node.op === '/' && variables(node.right).length > 0) out.push({ node: node.right, kind: 'zero' });
    guardsOf(node.left, out);
    guardsOf(node.right, out);
  } else if (node.type === 'unary' || node.type === 'postfix') guardsOf(node.arg, out);
  else if (node.type === 'call') {
    const [arg] = node.args;
    if (arg && variables(arg).length > 0 && (node.name === 'ln' || node.name === 'log')) {
      out.push({ node: arg, kind: 'notPositive' });
    } else if (arg && variables(arg).length > 0 && node.name === 'sqrt') out.push({ node: arg, kind: 'negative' });
    for (const a of node.args) guardsOf(a, out);
  }
  return out;
}

function undefinedAt(guard: Guard, name: string, value: number): boolean {
  if (variables(guard.node).some((n) => n !== name)) return false;
  const v = fn(guard.node)({ [name]: value });
  if (!Number.isFinite(v)) return true;
  const near = Math.abs(v) <= 1e-7 * Math.max(1, Math.abs(value));
  return guard.kind === 'zero' ? near : guard.kind === 'negative' ? v < 0 && !near : v <= 0 || near;
}

/** A solution found numerically, without the last digits of noise: 0.9999999999 is 1. */
const tidy = (v: number) => (Math.abs(v - Math.round(v)) < 1e-7 ? Math.round(v) : v);

/** x = y - 3/2: one side is a letter the other side does not use. */
function isolates(atom: Atom): boolean {
  if (atom.rel !== '=') return false;
  const alone = (side: Node, other: Node) => side.type === 'name' && !variables(other).includes(side.name);
  return alone(atom.left.node, atom.right.node) || alone(atom.right.node, atom.left.node);
}

/** The numbers written in a node, without 0 and 1, which rearranging adds and drops freely. */
function numbersIn(node: Node, out = new Set<number>()): Set<number> {
  if (node.type === 'num') {
    const v = Math.abs(node.value);
    if (v !== 0 && v !== 1) out.add(v);
  } else if (node.type === 'unary' || node.type === 'postfix') numbersIn(node.arg, out);
  else if (node.type === 'binary') {
    numbersIn(node.left, out);
    numbersIn(node.right, out);
  } else if (node.type === 'call') for (const arg of node.args) numbersIn(arg, out);
  return out;
}

/** True when the new line uses only numbers the line before it has: a rearrangement, not a new equation. */
function sameNumbers(before: Atom, after: Atom): boolean {
  const had = numbersIn(build.sub(before.left.node, before.right.node));
  const has = numbersIn(build.sub(after.left.node, after.right.node));
  return [...has].every((n) => had.has(n));
}

const alternative = (s: Scalar): Scalar => (s.alt ? { ...s, node: s.alt } : s);
const otherGroups = (groups: Atom[][]): Atom[][] =>
  groups.map((g) => g.map((atom) => ({ ...atom, left: alternative(atom.left), right: alternative(atom.right) })));
const hasAlt = (groups: Atom[][]) => groups.some((g) => g.some((atom) => atom.left.alt || atom.right.alt));

/**
 * A broken step where a line has a slash before a product (1/2x): checked again with the other reading, and right if
 * either reading is; else unchecked, since the slip may be only in how the line was read.
 */
function otherWay(prev: Relations | null, cur: Relations, found: Outcome, seed: number): Outcome {
  const [inPrev, inCur] = [prev !== null && hasAlt(prev.groups), hasAlt(cur.groups)];
  if (!inPrev && !inCur) return found;
  if (prev) {
    const readings: [Atom[][], Atom[][]][] = [
      [otherGroups(prev.groups), cur.groups],
      [prev.groups, otherGroups(cur.groups)],
      [otherGroups(prev.groups), otherGroups(cur.groups)],
    ];
    for (const [p, c] of readings) {
      const [a, b] = [equationOf(p), equationOf(c)];
      const again = a && b ? compareEquations(a, b, c, seed) : null;
      if (again?.verdict === 'ok') return again;
    }
  }
  return outcome('unchecked', 'ambiguous', 'none', 0, { text: inCur ? cur.text : (prev?.text ?? cur.text) });
}

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
  // The tutor may pass anything here: a limit that is not a positive number is the default.
  const positive = (n: unknown, fallback: number) => (typeof n === 'number' && n > 0 ? n : fallback);
  const seed = typeof options.seed === 'number' && Number.isFinite(options.seed) ? options.seed : DEFAULT_SEED;
  const maxLines = positive(options.maxLines, 200);
  const budget = positive(options.budgetMs, 4000);
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
  // An antiderivative with no + C is fine when a later line adds it; the first of a list of solutions, when the lines
  // after it list the rest.
  return results.map((r) =>
    checker.rootsListed.has(r.index) && r.reason === 'lostSolutions'
      ? { index: r.index, verdict: 'ok', reason: 'oneRoot', params: {}, method: 'solutions', confidence: 0.95 }
      : checker.constantAdded.has(r.index) && r.reason === 'missingConstant'
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
