// A small normal form for the calculus tools, so their answers read the way a textbook writes them. An expression
// becomes a sum of terms; each term is an exact fraction times factors, and each factor is a base to a power. Like
// terms are collected, powers of the same base are joined (x^2 * x is x^3, e^x * e^(2x) is e^(3x)), fractions
// cancel (2x / (2x) is 1), and functions of plain numbers that have a familiar exact value fold (sin(pi/6) is 1/2).
// A number times a sum is spread over the sum; other products of sums stay as they are, so nothing grows by itself.
// Like most computer algebra, it treats letters as ordinary positive numbers: (x^2)^(1/2) is x.
import { build, formatExpression, fractions } from '../../../core/expr';
import type { Node, Rational } from '../../../core/expr';
import { foldCall } from './exact';

export type Exponent = Rational | Node;

export interface Factor {
  base: Node;
  exp: Exponent;
  /** The base as text, which says when two bases are the same. */
  key: string;
}

export interface Term {
  coef: Rational;
  factors: Factor[];
}

/** A sum of terms. No terms is zero. */
export type Form = Term[];

/** Thrown when an expression grows too large to be worth tidying. */
export class TooLarge extends Error {}

const { num, name } = build;
const R = fractions;
export const ONE = R.ONE_RATIONAL;
export const ZERO = R.ZERO_RATIONAL;
export const HALF = R.rational(1n, 2n);
const MAX_TERMS = 80;
const MAX_KEY = 4000;

export const isRational = (exp: Exponent): exp is Rational => typeof (exp as Rational).n === 'bigint';
export const rationalOf = (n: number, d = 1): Rational => R.rational(BigInt(n), BigInt(d));
const isOne = (q: Rational) => q.n === 1n && q.d === 1n;
const isZero = (q: Rational) => q.n === 0n;

/** A fraction as a tree: 3, -2, or 1/2. */
export function rationalNode(q: Rational): Node {
  const magnitude = q.d === 1n ? num(Number(R.abs(q).n)) : build.div(num(Number(R.abs(q).n)), num(Number(q.d)));
  return q.n < 0n ? build.neg(magnitude) : magnitude;
}

const expKey = (exp: Exponent) => (isRational(exp) ? `${exp.n}/${exp.d}` : `(${formatExpression(exp)})`);
const termKey = (term: Term) => term.factors.map((f) => `${f.key}^${expKey(f.exp)}`).join('*');

function factor(base: Node, exp: Exponent): Factor {
  const key = formatExpression(base);
  if (key.length > MAX_KEY) throw new TooLarge();
  return { base, exp, key };
}

const constant = (q: Rational): Form => (isZero(q) ? [] : [{ coef: q, factors: [] }]);
const atom = (node: Node): Form => [{ coef: ONE, factors: [factor(node, ONE)] }];

/** The number a form stands for when it has no factors, or null. */
export function constantOf(form: Form): Rational | null {
  if (form.length === 0) return ZERO;
  return form.length === 1 && form[0].factors.length === 0 ? form[0].coef : null;
}

/** |u|^2 is u^2, so ln|x| has the slope 1/x. Factors that become the same are joined. */
function cleanTerm(term: Term): Term {
  if (!term.factors.some((f) => isEvenAbs(f))) return term;
  let out: Term = { coef: term.coef, factors: [] };
  for (const f of term.factors) {
    const next = isEvenAbs(f) ? factor((f.base as Node & { type: 'call' }).args[0], f.exp) : f;
    out = multiplyTerms(out, { coef: ONE, factors: [next] });
  }
  return out;
}

const isEvenAbs = (f: Factor) =>
  f.base.type === 'call' && f.base.name === 'abs' && isRational(f.exp) && R.isInteger(f.exp) && f.exp.n % 2n === 0n;

function addForms(a: Form, b: Form): Form {
  const terms = new Map<string, Term>();
  for (const raw of [...a, ...b]) {
    const term = cleanTerm(raw);
    const key = termKey(term);
    const found = terms.get(key);
    terms.set(key, found ? { coef: R.add(found.coef, term.coef), factors: found.factors } : term);
  }
  const out = [...terms.values()].filter((term) => !isZero(term.coef));
  if (out.length > MAX_TERMS) throw new TooLarge();
  return out;
}

const scale = (form: Form, q: Rational): Form =>
  isZero(q) ? [] : form.map((term) => ({ coef: R.mul(term.coef, q), factors: term.factors }));

function addExponents(a: Exponent, b: Exponent): Exponent {
  if (isRational(a) && isRational(b)) return R.add(a, b);
  const sum = norm(build.add(expNode(a), expNode(b)));
  return constantOf(sum) ?? toNode(sum);
}

export const expNode = (exp: Exponent): Node => (isRational(exp) ? rationalNode(exp) : exp);

function multiplyTerms(a: Term, b: Term): Term {
  const factors = [...a.factors];
  for (const next of b.factors) {
    const at = factors.findIndex((f) => f.key === next.key);
    if (at < 0) factors.push(next);
    else factors[at] = { ...factors[at], exp: addExponents(factors[at].exp, next.exp) };
  }
  return {
    coef: R.mul(a.coef, b.coef),
    factors: factors.filter((f) => !(isRational(f.exp) && isZero(f.exp))),
  };
}

/** A sum of several terms as one factor, so it can be multiplied as a whole. */
const asOne = (form: Form): Term => (form.length === 1 ? form[0] : { coef: ONE, factors: [factor(toNode(form), ONE)] });

function multiply(a: Form, b: Form): Form {
  if (a.length === 0 || b.length === 0) return [];
  const [ca, cb] = [constantOf(a), constantOf(b)];
  if (ca) return scale(b, ca);
  if (cb) return scale(a, cb);
  return addForms([], [multiplyTerms(asOne(a), asOne(b))]);
}

const undefinedForm = (): Form => atom(build.div(num(1), num(0)));

function reciprocal(form: Form): Form {
  if (form.length === 0) return undefinedForm();
  if (form.length > 1) return [{ coef: ONE, factors: [factor(toNode(form), R.neg(ONE))] }];
  const [term] = form;
  return [
    {
      coef: R.div(ONE, term.coef),
      factors: term.factors.map((f) => ({ ...f, exp: isRational(f.exp) ? R.neg(f.exp) : negated(f.exp) })),
    },
  ];
}

const negated = (exp: Node): Exponent => {
  const form = scale(norm(exp), R.neg(ONE));
  return constantOf(form) ?? toNode(form);
};

/** A whole number as out^k * rest, with out as large as a quick search finds: 12 is 2^2 * 3. */
function pullPower(value: bigint, k: number): [bigint, bigint] {
  let out = 1n;
  let rest = value;
  for (let p = 2n; p <= 1000n && p ** BigInt(k) <= rest; p += 1n) {
    const pk = p ** BigInt(k);
    while (rest % pk === 0n) {
      rest /= pk;
      out *= p;
    }
  }
  return [out, rest];
}

/** A positive fraction to a fractional power, with what is exact taken out: sqrt(12/9) is 2 sqrt(3) / 3. */
function powerOfCoefficient(coef: Rational, q: Rational): Term {
  if (R.isInteger(q)) return { coef: R.powInt(coef, q.n), factors: [] };
  const k = Number(q.d);
  const magnitude = q.n < 0n ? -q.n : q.n;
  let out = coef.n < 0n ? R.neg(ONE) : ONE;
  const parts: Factor[] = [];
  for (const [value, side] of [
    [R.abs(coef).n, 1n],
    [coef.d, -1n],
  ] as const) {
    const [taken, rest] = pullPower(value ** magnitude, k);
    out = R.mul(out, side > 0n ? R.rational(taken) : R.rational(1n, taken));
    if (rest !== 1n) parts.push(factor(num(Number(rest)), R.rational(side, q.d)));
  }
  const term: Term = { coef: out, factors: parts };
  return q.n < 0n ? reciprocal([term])[0] : term;
}

function power(form: Form, q: Rational): Form {
  if (isZero(q)) return constant(ONE);
  if (form.length === 0) return q.n > 0n ? [] : undefinedForm();
  if (isOne(q)) return form;
  if (form.length > 1) return [{ coef: ONE, factors: [factor(toNode(form), q)] }];
  const [term] = form;
  const raised: Term = {
    coef: ONE,
    factors: term.factors.map((f) => ({
      ...f,
      exp: isRational(f.exp) ? R.mul(f.exp, q) : (constantOf(norm(build.mul(f.exp, rationalNode(q)))) ?? f.exp),
    })),
  };
  return addForms([], [multiplyTerms(powerOfCoefficient(term.coef, q), raised)]);
}

function raise(base: Form, exponent: Node): Form {
  const exp = norm(exponent);
  const q = constantOf(exp);
  if (q) return power(base, q);
  const b = constantOf(base);
  if (b && isOne(b)) return constant(ONE);
  const single = base.length === 1 && isOne(base[0].coef) && base[0].factors.length === 1 ? base[0].factors[0] : null;
  // (b^u)^v is b^(u v), which keeps e^(2x) one factor of e.
  if (single) {
    const joined = norm(build.mul(expNode(single.exp), toNode(exp)));
    return [{ coef: ONE, factors: [{ ...single, exp: constantOf(joined) ?? toNode(joined) }] }];
  }
  return [{ coef: ONE, factors: [factor(toNode(base), toNode(exp))] }];
}

const E = name('e');

function callForm(node: Node & { type: 'call' }): Form {
  const args = node.args.map((arg) => tidy(arg));
  const [u] = args;
  switch (node.name) {
    case 'sqrt':
      return power(norm(u), HALF);
    case 'cbrt':
      return power(norm(u), rationalOf(1, 3));
    case 'exp':
      return raise(atom(E), u);
    case 'pow':
      return raise(norm(u), args[1]);
    default: {
      const folded = foldCall(node.name, args);
      return folded ? norm(folded) : atom(build.call(node.name, ...args));
    }
  }
}

function binaryForm(node: Node & { type: 'binary' }): Form {
  const { op, left, right } = node;
  switch (op) {
    case '+':
      return addForms(norm(left), norm(right));
    case '-':
      return addForms(norm(left), scale(norm(right), R.neg(ONE)));
    case '*':
      return multiply(norm(left), norm(right));
    case '/':
      return multiply(norm(left), reciprocal(norm(right)));
    case '^':
      return raise(norm(left), right);
    default:
      return atom(node);
  }
}

/** The normal form of a tree. */
export function norm(node: Node): Form {
  switch (node.type) {
    case 'num': {
      const q = R.fromNumber(node.value);
      return q ? constant(q) : atom(node);
    }
    case 'unary':
      if (node.op === '-') return scale(norm(node.arg), R.neg(ONE));
      return node.op === '+' ? norm(node.arg) : power(norm(node.arg), HALF);
    case 'binary':
      return binaryForm(node);
    case 'call':
      return callForm(node);
    default:
      return atom(node);
  }
}

/** How much a term grows with its letters, so terms read from the highest power down and constants come last. */
function weight(term: Term): number {
  return term.factors.reduce((sum, f) => {
    if (f.base.type === 'num') return sum;
    return sum + (isRational(f.exp) ? R.toNumber(f.exp) : 1);
  }, 0);
}

const CALL_ORDER = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'];

function factorRank(f: Factor): number {
  if (f.base.type === 'num') return 0;
  if (f.base.type === 'name') return f.key === 'e' ? 3 : 1;
  if (f.base.type !== 'call') return 20;
  const at = CALL_ORDER.indexOf(f.base.name);
  return at < 0 ? 4 + CALL_ORDER.length : 4 + at;
}

/** Terms in reading order, and each term's factors in reading order. */
export function ordered(form: Form): Form {
  const terms = form.map((term) => ({
    coef: term.coef,
    factors: [...term.factors].sort((a, b) => factorRank(a) - factorRank(b) || (a.key < b.key ? -1 : 1)),
  }));
  terms.sort((a, b) => weight(b) - weight(a) || (termKey(a) < termKey(b) ? -1 : 1));
  // 1 - x^2 reads better than -x^2 + 1: a positive term goes first when there is one.
  const positive = terms.findIndex((term) => term.coef.n > 0n);
  if (positive > 0 && terms[0].coef.n < 0n) terms.unshift(...terms.splice(positive, 1));
  return terms;
}

function factorNode(f: Factor, exp: Exponent): Node {
  if (isRational(exp)) {
    if (isOne(exp)) return f.base;
    if (exp.n === 1n && exp.d === 2n) return build.call('sqrt', f.base);
  }
  return build.pow(f.base, expNode(exp));
}

function termNode(term: Term): Node {
  const top: Node[] = [];
  const bottom: Node[] = [];
  const magnitude = R.abs(term.coef);
  if (magnitude.n !== 1n || term.factors.every((f) => isRational(f.exp) && f.exp.n < 0n))
    top.push(num(Number(magnitude.n)));
  for (const f of term.factors) {
    if (isRational(f.exp) && f.exp.n < 0n) bottom.push(factorNode(f, R.neg(f.exp)));
    else top.push(factorNode(f, f.exp));
  }
  const product = (nodes: Node[]) => nodes.reduce((a, b) => build.mul(a, b));
  const fraction = bottom.length === 0 ? product(top) : build.div(product(top), product(bottom));
  // The number under the bar divides last, so it is not spread over a sum below it when read back.
  return magnitude.d === 1n ? fraction : build.div(fraction, num(Number(magnitude.d)));
}

/** The tree for a normal form. */
export function toNode(form: Form): Node {
  if (form.length === 0) return num(0);
  return ordered(form).reduce<Node | null>((sum, term) => {
    const node = termNode(term);
    const negative = term.coef.n < 0n;
    if (sum === null) return negative ? build.neg(node) : node;
    return negative ? build.sub(sum, node) : build.add(sum, node);
  }, null) as Node;
}

/** The tidy form of a tree, as a tree. */
export const tidy = (node: Node): Node => toNode(norm(node));

/** True when two trees have the same normal form. */
export const sameForm = (a: Node, b: Node): boolean =>
  formatExpression(tidy(build.sub(a, b))) === '0' || formatExpression(tidy(a)) === formatExpression(tidy(b));

/** Spreads products over sums, and whole powers of sums, so (x + 1)^2 is x^2 + 2x + 1. */
export function expand(form: Form): Form {
  let out: Form = [];
  for (const term of form) {
    let product: Form = [{ coef: term.coef, factors: [] }];
    for (const f of term.factors) {
      const inner = norm(f.base);
      const times = isRational(f.exp) && R.isInteger(f.exp) && f.exp.n > 0n && f.exp.n <= 8n ? Number(f.exp.n) : 0;
      if (inner.length > 1 && times > 0) {
        const spread = expand(inner);
        for (let i = 0; i < times; i += 1) product = spreadTimes(product, spread);
      } else product = spreadTimes(product, [{ coef: ONE, factors: [f] }]);
    }
    out = addForms(out, product);
  }
  return out;
}

/** Multiplies out the sums inside each term's factors, keeping the factors: (2x(x-1) - x^2) / y is (x^2 - 2x) / y. */
export function expandInside(form: Form): Form {
  const terms = form.map((term) => ({
    coef: term.coef,
    factors: term.factors.map((f) => (norm(f.base).length > 1 ? factor(toNode(expand(norm(f.base))), f.exp) : f)),
  }));
  return addForms([], terms);
}

function spreadTimes(a: Form, b: Form): Form {
  let out: Form = [];
  for (const s of a) for (const t of b) out = addForms(out, [multiplyTerms(s, t)]);
  return out;
}

/** Replaces a name with a tree everywhere. */
export function substitute(node: Node, variable: string, value: Node): Node {
  switch (node.type) {
    case 'name':
      return node.name === variable ? value : node;
    case 'unary':
      return { ...node, arg: substitute(node.arg, variable, value) };
    case 'binary':
      return { ...node, left: substitute(node.left, variable, value), right: substitute(node.right, variable, value) };
    case 'call':
      return { ...node, args: node.args.map((arg) => substitute(arg, variable, value)) };
    case 'postfix':
      return { ...node, arg: substitute(node.arg, variable, value) };
    default:
      return node;
  }
}

/** The shortest of the tidy, the multiplied-out-inside, and the fully multiplied-out forms of a tree. */
export function simplest(node: Node): Node {
  const form = norm(node);
  const options = [toNode(form)];
  try {
    options.push(toNode(expandInside(form)), toNode(expand(form)));
  } catch (error) {
    if (!(error instanceof TooLarge)) throw error;
  }
  const size = (candidate: Node) => formatExpression(candidate).length;
  return options.reduce((best, next) => (size(next) < size(best) ? next : best));
}
