// Formulas of propositional, first-order, and modal logic: a tokenizer and a precedence-climbing parser of their own
// (nothing is evaluated as code), a printer, and helpers for free variables and substitution. Connectives may be
// typed as words or symbols. Negation, quantifiers, and the modal operators bind tightest, then and, or, implies,
// and iff; implies and iff group to the right. Predicates are written P(x, y) or, in the textbook style, Pxy.
import { fail } from '../core/util';

export type Term = { k: 'var'; name: string } | { k: 'fn'; name: string; args: Term[] };

export type Formula =
  | { k: 'atom'; name: string }
  | { k: 'pred'; name: string; args: Term[] }
  | { k: 'eq'; a: Term; b: Term }
  | { k: 'top' }
  | { k: 'bot' }
  | { k: 'not'; f: Formula }
  | { k: 'and' | 'or' | 'imp' | 'iff'; a: Formula; b: Formula }
  | { k: 'all' | 'some'; v: string; f: Formula }
  | { k: 'box' | 'dia'; f: Formula };

type Tok = { t: string; v?: string; at: number };

const WORDS: Record<string, string> = {
  not: '¬',
  and: '∧',
  or: '∨',
  implies: '→',
  iff: '↔',
  forall: '∀',
  all: '∀',
  exists: '∃',
  some: '∃',
  box: '□',
  nec: '□',
  dia: '◇',
  poss: '◇',
  true: '⊤',
  false: '⊥',
  bot: '⊥',
  top: '⊤',
};

const SYMBOLS: [string, string][] = [
  ['<->', '↔'],
  ['<=>', '↔'],
  ['->', '→'],
  ['=>', '→'],
  ['/\\', '∧'],
  ['\\/', '∨'],
  ['[]', '□'],
  ['<>', '◇'],
  ['!=', '≠'],
  ['~', '¬'],
  ['!', '¬'],
  ['-', '¬'],
  ['&', '∧'],
  ['^', '∧'],
  ['|', '∨'],
  ['+', '∨'],
  ['⊃', '→'],
  ['≡', '↔'],
  ['·', '∧'],
  ['∼', '¬'],
];

const OPS = new Set(['¬', '∧', '∨', '→', '↔', '∀', '∃', '□', '◇', '⊤', '⊥', '(', ')', ',', '=', '≠']);

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const s = [...text];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const rest = s.slice(i, i + 3).join('');
    const sym = SYMBOLS.find(([k]) => rest.startsWith(k));
    if (sym) {
      out.push({ t: sym[1], at: i });
      i += [...sym[0]].length;
      continue;
    }
    if (OPS.has(c)) {
      out.push({ t: c, at: i });
      i += 1;
      continue;
    }
    if (/[A-Za-z_0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z_0-9']/.test(s[j])) j += 1;
      const word = s.slice(i, j).join('');
      const w = WORDS[word.toLowerCase()];
      out.push(w ? { t: w, at: i } : { t: 'id', v: word, at: i });
      i = j;
      continue;
    }
    fail('badChar', { c, at: i + 1 });
  }
  return out;
}

const BINARY: Record<string, { k: 'and' | 'or' | 'imp' | 'iff'; prec: number; right: boolean }> = {
  '∧': { k: 'and', prec: 4, right: false },
  '∨': { k: 'or', prec: 3, right: false },
  '→': { k: 'imp', prec: 2, right: true },
  '↔': { k: 'iff', prec: 1, right: true },
};

class Parser {
  i = 0;

  constructor(
    readonly toks: readonly Tok[],
    readonly length: number,
  ) {}

  peek = (): Tok | undefined => this.toks[this.i];
  at = (): number => (this.peek()?.at ?? this.length) + 1;

  expect(t: string): void {
    if (this.peek()?.t !== t) fail('expected', { what: t, at: this.at() });
    this.i += 1;
  }

  args(): Term[] {
    this.expect('(');
    const out = [this.term()];
    while (this.peek()?.t === ',') {
      this.i += 1;
      out.push(this.term());
    }
    this.expect(')');
    return out;
  }

  term(): Term {
    const tk = this.peek();
    if (tk?.t !== 'id') return fail('expected', { what: 'term', at: this.at() });
    this.i += 1;
    return this.peek()?.t === '(' ? { k: 'fn', name: tk.v!, args: this.args() } : { k: 'var', name: tk.v! };
  }

  /** A lowercase name: an identity such as a = f(b), or else a sentence letter. */
  lower(name: string): Formula {
    const save = this.i;
    const t = this.term();
    const op = this.peek()?.t;
    if (op === '=' || op === '≠') {
      this.i += 1;
      const eq: Formula = { k: 'eq', a: t, b: this.term() };
      return op === '≠' ? { k: 'not', f: eq } : eq;
    }
    if (t.k === 'fn') return fail('expected', { what: '=', at: this.at() });
    this.i = save + 1;
    return { k: 'atom', name };
  }

  /** A capitalized name: P(x, y), the textbook Pxy, or a bare sentence letter. */
  upper(name: string): Formula {
    this.i += 1;
    if (this.peek()?.t === '(') return { k: 'pred', name, args: this.args() };
    const m = /^([A-Z])([a-z0-9]+)$/.exec(name);
    if (m) return { k: 'pred', name: m[1], args: [...m[2]].map((c) => ({ k: 'var', name: c }) as Term) };
    return { k: 'atom', name };
  }

  unary(): Formula {
    const tk = this.peek();
    if (!tk) return fail('unexpectedEnd');
    const t = tk.t;
    if (t === '¬' || t === '□' || t === '◇') {
      this.i += 1;
      return { k: t === '¬' ? 'not' : t === '□' ? 'box' : 'dia', f: this.unary() };
    }
    if (t === '∀' || t === '∃') {
      this.i += 1;
      const v = this.peek();
      if (v?.t !== 'id') fail('expected', { what: 'variable', at: this.at() });
      this.i += 1;
      return { k: t === '∀' ? 'all' : 'some', v: v!.v!, f: this.unary() };
    }
    if (t === '⊤' || t === '⊥') {
      this.i += 1;
      return { k: t === '⊤' ? 'top' : 'bot' };
    }
    if (t === '(') {
      this.i += 1;
      const f = this.binary(0);
      this.expect(')');
      return f;
    }
    if (t === 'id') return /^[a-z0-9]/.test(tk.v!) ? this.lower(tk.v!) : this.upper(tk.v!);
    return fail('expected', { what: 'formula', at: tk.at + 1 });
  }

  binary(min: number): Formula {
    let left = this.unary();
    for (;;) {
      const op = BINARY[this.peek()?.t ?? ''];
      if (!op || op.prec < min) return left;
      this.i += 1;
      const right = this.binary(op.right ? op.prec : op.prec + 1);
      left = { k: op.k, a: left, b: right };
    }
  }
}

export function parseFormula(text: string): Formula {
  const toks = tokenize(text);
  if (toks.length === 0) fail('emptyFormula');
  const p = new Parser(toks, text.length);
  const f = p.binary(0);
  if (p.i < toks.length) fail('expected', { what: 'end', at: toks[p.i].at + 1 });
  return f;
}

type Bin = 'and' | 'or' | 'imp' | 'iff';
const isBin = (f: Formula): f is Extract<Formula, { k: Bin }> =>
  f.k === 'and' || f.k === 'or' || f.k === 'imp' || f.k === 'iff';

/**
 * A binary part in parentheses when it could be misread. A conjunction inside a disjunction (and the reverse) always
 * gets them. So does an arrow inside a conjunction or disjunction, the same arrow on the left, and a mixed arrow.
 */
function wrap(parent: Bin, child: Formula, left: boolean): string {
  const text = show(child);
  if (!isBin(child)) return text;
  const arrow = (k: Bin) => k === 'imp' || k === 'iff';
  const need = arrow(parent) ? arrow(child.k) && (child.k !== parent || left) : child.k !== parent;
  return need ? `(${text})` : text;
}

const SYM = { and: '∧', or: '∨', imp: '→', iff: '↔' } as const;

export function termText(t: Term): string {
  return t.k === 'var' ? t.name : `${t.name}(${t.args.map(termText).join(', ')})`;
}

const unaryPart = (f: Formula): string => (isBin(f) ? `(${show(f)})` : show(f));

/** The formula with symbols and only the parentheses it needs. */
export function show(f: Formula): string {
  switch (f.k) {
    case 'atom':
      return f.name;
    case 'pred':
      return f.args.length && f.args.every((a) => a.k === 'var' && a.name.length === 1)
        ? `${f.name}${f.args.map(termText).join('')}`
        : `${f.name}(${f.args.map(termText).join(', ')})`;
    case 'eq':
      return `${termText(f.a)} = ${termText(f.b)}`;
    case 'top':
      return '⊤';
    case 'bot':
      return '⊥';
    case 'not':
      return f.f.k === 'eq' ? `${termText(f.f.a)} ≠ ${termText(f.f.b)}` : `¬${unaryPart(f.f)}`;
    case 'box':
      return `□${unaryPart(f.f)}`;
    case 'dia':
      return `◇${unaryPart(f.f)}`;
    case 'all':
    case 'some':
      return `${f.k === 'all' ? '∀' : '∃'}${f.v} ${unaryPart(f.f)}`;
    default: {
      const left = wrap(f.k, f.a, true);
      const right = wrap(f.k, f.b, false);
      return `${left} ${SYM[f.k]} ${right}`;
    }
  }
}

export const same = (a: Formula, b: Formula): boolean => show(a) === show(b);

/** The sentence letters of a propositional formula, in order of first appearance. */
export function letters(f: Formula, out: string[] = []): string[] {
  if (f.k === 'atom' && !out.includes(f.name)) out.push(f.name);
  else if (f.k === 'pred' && f.args.length === 0 && !out.includes(f.name)) out.push(f.name);
  else if (f.k === 'not' || f.k === 'box' || f.k === 'dia' || f.k === 'all' || f.k === 'some') letters(f.f, out);
  else if (f.k === 'and' || f.k === 'or' || f.k === 'imp' || f.k === 'iff') {
    letters(f.a, out);
    letters(f.b, out);
  }
  return out;
}

export const isPropositional = (f: Formula): boolean => {
  switch (f.k) {
    case 'atom':
    case 'top':
    case 'bot':
      return true;
    case 'not':
      return isPropositional(f.f);
    case 'and':
    case 'or':
    case 'imp':
    case 'iff':
      return isPropositional(f.a) && isPropositional(f.b);
    default:
      return false;
  }
};

/** Evaluates a propositional formula under an assignment of its letters. */
export function evaluate(f: Formula, v: (name: string) => boolean): boolean {
  switch (f.k) {
    case 'atom':
      return v(f.name);
    case 'top':
      return true;
    case 'bot':
      return false;
    case 'not':
      return !evaluate(f.f, v);
    case 'and':
      return evaluate(f.a, v) && evaluate(f.b, v);
    case 'or':
      return evaluate(f.a, v) || evaluate(f.b, v);
    case 'imp':
      return !evaluate(f.a, v) || evaluate(f.b, v);
    case 'iff':
      return evaluate(f.a, v) === evaluate(f.b, v);
    default:
      return fail('notPropositional');
  }
}

/* ---------- Terms, free variables, and substitution ---------- */

export function termVars(t: Term, out = new Set<string>()): Set<string> {
  if (t.k === 'var') out.add(t.name);
  else t.args.forEach((a) => termVars(a, out));
  return out;
}

export function freeVars(f: Formula, out = new Set<string>()): Set<string> {
  switch (f.k) {
    case 'pred':
      f.args.forEach((a) => termVars(a, out));
      break;
    case 'eq':
      termVars(f.a, out);
      termVars(f.b, out);
      break;
    case 'not':
    case 'box':
    case 'dia':
      freeVars(f.f, out);
      break;
    case 'all':
    case 'some': {
      const inner = freeVars(f.f);
      inner.delete(f.v);
      inner.forEach((x) => out.add(x));
      break;
    }
    case 'and':
    case 'or':
    case 'imp':
    case 'iff':
      freeVars(f.a, out);
      freeVars(f.b, out);
      break;
    default:
  }
  return out;
}

/** Every name in the formula's terms, whether a quantifier binds it or not. */
export function names(f: Formula, out = new Set<string>()): Set<string> {
  switch (f.k) {
    case 'pred':
      f.args.forEach((a) => termVars(a, out));
      break;
    case 'eq':
      termVars(f.a, out);
      termVars(f.b, out);
      break;
    case 'not':
    case 'box':
    case 'dia':
    case 'all':
    case 'some':
      names(f.f, out);
      break;
    case 'and':
    case 'or':
    case 'imp':
    case 'iff':
      names(f.a, out);
      names(f.b, out);
      break;
    default:
  }
  return out;
}

const substTerm = (t: Term, x: string, by: Term): Term =>
  t.k === 'var' ? (t.name === x ? by : t) : { ...t, args: t.args.map((a) => substTerm(a, x, by)) };

/** The formula with the free occurrences of x replaced by a term (no capture check: callers pick fresh names). */
export function subst(f: Formula, x: string, by: Term): Formula {
  switch (f.k) {
    case 'pred':
      return { ...f, args: f.args.map((a) => substTerm(a, x, by)) };
    case 'eq':
      return { k: 'eq', a: substTerm(f.a, x, by), b: substTerm(f.b, x, by) };
    case 'not':
    case 'box':
    case 'dia':
      return { k: f.k, f: subst(f.f, x, by) };
    case 'all':
    case 'some':
      return f.v === x ? f : { ...f, f: subst(f.f, x, by) };
    case 'and':
    case 'or':
    case 'imp':
    case 'iff':
      return { k: f.k, a: subst(f.a, x, by), b: subst(f.b, x, by) };
    default:
      return f;
  }
}
