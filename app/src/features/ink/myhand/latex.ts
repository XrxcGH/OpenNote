// A small reader for the LaTeX that typed math holds (the equation editor and $...$), into the structure the math
// layout needs: fractions, scripts, roots, big operators with limits, brackets that grow, matrices, cases, and
// aligned lines. It never throws on odd input: an unknown command reads as its name, and an unclosed group closes
// at the end. The input is capped, and so is the nesting, so pasted text can't hold it up.

export type MathNode =
  | { readonly t: 'sym'; readonly c: string; readonly cls: 'ord' | 'bin' | 'rel' | 'punct' | 'open' | 'close' }
  | { readonly t: 'row'; readonly items: readonly MathNode[] }
  | { readonly t: 'frac'; readonly num: MathNode; readonly den: MathNode }
  | { readonly t: 'scripts'; readonly base: MathNode; readonly sup?: MathNode; readonly sub?: MathNode }
  | { readonly t: 'sqrt'; readonly body: MathNode; readonly index?: MathNode }
  | { readonly t: 'op'; readonly c: string; readonly limits: boolean }
  | { readonly t: 'delim'; readonly open: string; readonly close: string; readonly body: MathNode }
  | {
      readonly t: 'matrix';
      readonly rows: readonly (readonly MathNode[])[];
      readonly open: string;
      readonly close: string;
      readonly align: 'center' | 'left';
    }
  | { readonly t: 'align'; readonly rows: readonly (readonly MathNode[])[] }
  | { readonly t: 'accent'; readonly kind: 'vec' | 'hat' | 'dot' | 'bar' | 'tilde'; readonly body: MathNode }
  | { readonly t: 'text'; readonly s: string }
  | { readonly t: 'space'; readonly w: number };

export const MAX_LATEX = 5000;
const MAX_DEPTH = 40;

const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  prime: '′',
  degree: '°',
  circ: '°',
  ldots: '…',
  dots: '…',
  cdots: '…',
  ell: 'l',
  hbar: 'ħ',
  angle: '∠',
  triangle: 'Δ',
  forall: '∀',
  exists: '∃',
  emptyset: '∅',
};
const BINARY: Record<string, string> = {
  times: '×',
  div: '÷',
  cdot: '·',
  pm: '±',
  mp: '∓',
  ast: '*',
  cup: '∪',
  cap: '∩',
};
const RELATIONS: Record<string, string> = {
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '~',
  propto: '∝',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  gets: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  implies: '⇒',
  Leftrightarrow: '⇔',
  iff: '⇔',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  mapsto: '→',
  perp: '⊥',
  parallel: '∥',
  ll: '≪',
  gg: '≫',
};
const FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'log',
  'ln',
  'exp',
  'det',
  'dim',
  'ker',
  'deg',
  'gcd',
  'arg',
  'Re',
  'Im',
]);
const LIMIT_FUNCTIONS = new Set(['lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf']);
const BIG_OPS: Record<string, string> = {
  int: '∫',
  iint: '∫∫',
  iiint: '∫∫∫',
  oint: '∮',
  sum: '∑',
  prod: '∏',
  coprod: '∐',
  bigcup: '∪',
  bigcap: '∩',
};
const SPACES: Record<string, number> = {
  ',': 0.17,
  ':': 0.22,
  ';': 0.28,
  '!': -0.17,
  ' ': 0.3,
  quad: 1,
  qquad: 2,
  enspace: 0.5,
};
const ACCENTS: Record<string, 'vec' | 'hat' | 'dot' | 'bar' | 'tilde'> = {
  vec: 'vec',
  overrightarrow: 'vec',
  hat: 'hat',
  widehat: 'hat',
  dot: 'dot',
  bar: 'bar',
  overline: 'bar',
  tilde: 'tilde',
  widetilde: 'tilde',
};
const DELIMS: Record<string, string> = {
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '|': '|',
  '.': '',
  '\\{': '{',
  '\\}': '}',
  '\\lbrace': '{',
  '\\rbrace': '}',
  '\\langle': '⟨',
  '\\rangle': '⟩',
  '\\|': '‖',
  '\\vert': '|',
  '\\Vert': '‖',
  '\\lvert': '|',
  '\\rvert': '|',
  '<': '⟨',
  '>': '⟩',
};

const BIN_CHARS = new Set(['+', '-', '−', '*', '×', '÷', '·', '±']);
const REL_CHARS = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '→', '⇒', '⇔', ':', '∈']);

const sym = (c: string): MathNode => ({
  t: 'sym',
  c: c === '-' ? '-' : c,
  cls: BIN_CHARS.has(c)
    ? 'bin'
    : REL_CHARS.has(c)
      ? 'rel'
      : ',;'.includes(c)
        ? 'punct'
        : '([{'.includes(c)
          ? 'open'
          : ')]}'.includes(c)
            ? 'close'
            : 'ord',
});
const row = (items: MathNode[]): MathNode => (items.length === 1 ? items[0] : { t: 'row', items });

type Token =
  | { k: 'cmd'; v: string }
  | { k: 'char'; v: string }
  | { k: '{' }
  | { k: '}' }
  | { k: '^' }
  | { k: '_' }
  | { k: '&' }
  | { k: 'nl' };

export function tokenize(source: string): Token[] {
  const text = source.slice(0, MAX_LATEX);
  const out: Token[] = [];
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '\\') {
      const rest = text.slice(i + 1);
      const word = /^[A-Za-z]+/.exec(rest)?.[0];
      if (word) {
        out.push({ k: 'cmd', v: word });
        i += 1 + word.length;
      } else if (rest[0] === '\\') {
        out.push({ k: 'nl' });
        i += 2;
      } else if (rest.length > 0) {
        out.push({ k: 'cmd', v: rest[0] });
        i += 2;
      } else i += 1;
      continue;
    }
    if (c === '%') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '{' || c === '}' || c === '^' || c === '_' || c === '&') out.push({ k: c } as Token);
    else {
      const code = text.codePointAt(i) ?? 0;
      const char = String.fromCodePoint(code);
      out.push({ k: 'char', v: char });
      i += char.length;
      continue;
    }
    i++;
  }
  return out;
}

class Parser {
  private at = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private next(): Token | undefined {
    return this.tokens[this.at++];
  }

  /** A list of items up to a closing brace, a column or row mark, \right, or \end, which it leaves unread. */
  list(stopAt: (token: Token) => boolean): MathNode[] {
    const items: MathNode[] = [];
    while (this.at < this.tokens.length) {
      const token = this.peek()!;
      if (stopAt(token)) break;
      if (token.k === '^' || token.k === '_') {
        this.next();
        const script = this.argument();
        const base = items.pop() ?? { t: 'row', items: [] };
        const prev = base.t === 'scripts' ? base : { t: 'scripts' as const, base };
        items.push(token.k === '^' ? { ...prev, sup: script } : { ...prev, sub: script });
        continue;
      }
      const item = this.atom();
      if (item) items.push(item);
    }
    return items;
  }

  private guard<T>(fn: () => T, fallback: T): T {
    if (this.depth >= MAX_DEPTH) return fallback;
    this.depth += 1;
    try {
      return fn();
    } finally {
      this.depth -= 1;
    }
  }

  /** One argument: a group in braces, or a single token. */
  argument(): MathNode {
    return this.guard(
      () => {
        const token = this.peek();
        if (!token) return { t: 'row', items: [] } as MathNode;
        if (token.k === '{') {
          this.next();
          const items = this.list((t) => t.k === '}');
          if (this.peek()?.k === '}') this.next();
          return row(items);
        }
        return this.atom() ?? ({ t: 'row', items: [] } as MathNode);
      },
      { t: 'row', items: [] },
    );
  }

  /** Raw text in braces, for \text and \begin. */
  private rawGroup(): string {
    if (this.peek()?.k !== '{') return '';
    this.next();
    let out = '';
    let level = 0;
    while (this.at < this.tokens.length) {
      const token = this.next()!;
      if (token.k === '}' && level === 0) break;
      if (token.k === '{') level++;
      if (token.k === '}') level--;
      out +=
        token.k === 'char'
          ? token.v
          : token.k === 'cmd'
            ? token.v === ' '
              ? ' '
              : (SYMBOLS[token.v] ?? token.v)
            : token.k === 'nl'
              ? ' '
              : token.k === '&'
                ? '&'
                : '';
    }
    return out;
  }

  private delimiter(): string {
    const token = this.next();
    if (!token) return '';
    if (token.k === 'char') return DELIMS[token.v] ?? token.v;
    if (token.k === 'cmd') return DELIMS[`\\${token.v}`] ?? (token.v === '{' ? '{' : token.v === '}' ? '}' : '');
    return '';
  }

  private environment(name: string): MathNode {
    const rows: MathNode[][] = [[]];
    const stop = (t: Token) => t.k === '&' || t.k === 'nl' || (t.k === 'cmd' && t.v === 'end');
    if (name === 'array') this.rawGroup();
    while (this.at < this.tokens.length) {
      const items = this.guard(() => this.list(stop), []);
      rows[rows.length - 1].push(row(items));
      const token = this.next();
      if (!token || (token.k === 'cmd' && token.v === 'end')) {
        this.rawGroup();
        break;
      }
      if (token.k === 'nl') rows.push([]);
    }
    const kept = rows.filter((r) => r.some((c) => !(c.t === 'row' && c.items.length === 0)));
    const base = name.replace(/\*$/, '');
    if (['aligned', 'align', 'split', 'gathered', 'gather', 'alignat', 'eqnarray', 'flalign'].includes(base))
      return { t: 'align', rows: kept };
    const brackets: Record<string, [string, string]> = {
      pmatrix: ['(', ')'],
      bmatrix: ['[', ']'],
      Bmatrix: ['{', '}'],
      vmatrix: ['|', '|'],
      Vmatrix: ['‖', '‖'],
      cases: ['{', ''],
    };
    const [open, close] = brackets[base] ?? ['', ''];
    return { t: 'matrix', rows: kept, open, close, align: base === 'cases' ? 'left' : 'center' };
  }

  private command(name: string): MathNode | null {
    if (name in SYMBOLS) return sym(SYMBOLS[name]);
    if (name in BINARY) return { t: 'sym', c: BINARY[name], cls: 'bin' };
    if (name in RELATIONS) return { t: 'sym', c: RELATIONS[name], cls: 'rel' };
    if (name in SPACES) return { t: 'space', w: SPACES[name] };
    if (name in BIG_OPS) return { t: 'op', c: BIG_OPS[name], limits: !name.includes('int') };
    if (FUNCTIONS.has(name)) return { t: 'text', s: name };
    if (LIMIT_FUNCTIONS.has(name)) return { t: 'op', c: name, limits: true };
    if (name in ACCENTS) return { t: 'accent', kind: ACCENTS[name], body: this.argument() };
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac': {
        const num = this.argument();
        return { t: 'frac', num, den: this.argument() };
      }
      case 'binom': {
        const top = this.argument();
        const bottom = this.argument();
        return { t: 'matrix', rows: [[top], [bottom]], open: '(', close: ')', align: 'center' };
      }
      case 'sqrt': {
        let index: MathNode | undefined;
        if (this.peek()?.k === 'char' && (this.peek() as { v: string }).v === '[') {
          this.next();
          index = row(this.list((t) => t.k === 'char' && t.v === ']'));
          this.next();
        }
        return { t: 'sqrt', body: this.argument(), index };
      }
      case 'left': {
        const open = this.delimiter();
        const body = this.guard(() => row(this.list((t) => t.k === 'cmd' && t.v === 'right')), {
          t: 'row',
          items: [],
        } as MathNode);
        this.next();
        return { t: 'delim', open, close: this.delimiter(), body };
      }
      case 'right':
        this.delimiter();
        return null;
      case 'begin':
        return this.guard(() => this.environment(this.rawGroup()), { t: 'row', items: [] } as MathNode);
      case 'text':
      case 'textrm':
      case 'textit':
      case 'mbox':
      case 'operatorname':
        return { t: 'text', s: this.rawGroup() };
      case 'mathrm':
      case 'mathbf':
      case 'mathit':
      case 'mathsf':
      case 'boldsymbol':
      case 'mathcal':
      case 'mathbb':
      case 'displaystyle':
      case 'textstyle':
      case 'limits':
      case 'nolimits':
        return name.startsWith('math') || name === 'boldsymbol' ? this.argument() : null;
      case '{':
        return sym('{');
      case '}':
        return sym('}');
      case '|':
        return sym('‖');
      case '\\':
        return null;
      default:
        // A command this reader doesn't know is written as its name, so nothing the person typed is lost.
        return name.length === 1 ? sym(name) : { t: 'text', s: name };
    }
  }

  atom(): MathNode | null {
    const token = this.next();
    if (!token) return null;
    switch (token.k) {
      case 'char':
        return sym(token.v === "'" ? '′' : token.v);
      case 'cmd':
        return this.command(token.v);
      case '{': {
        const items = this.guard(() => this.list((t) => t.k === '}'), []);
        if (this.peek()?.k === '}') this.next();
        return row(items);
      }
      default:
        // A stray brace, column mark, or line break at the top level is left out.
        return null;
    }
  }
}

/**
 * Reads LaTeX into the layout's structure. A `\\` or `&` outside an environment makes aligned lines, as display math
 * often is typed without `\begin{aligned}`.
 */
export function parseLatex(source: string): MathNode {
  const tokens = tokenize(source);
  let level = 0;
  const topLevelBreak = tokens.some((t) => {
    if (t.k === 'cmd' && t.v === 'begin') level++;
    if (t.k === 'cmd' && t.v === 'end') level--;
    return level <= 0 && (t.k === 'nl' || t.k === '&');
  });
  if (topLevelBreak) {
    const wrapped: Token[] = [
      { k: 'cmd', v: 'begin' },
      { k: '{' },
      ...[...'aligned'].map((v) => ({ k: 'char', v }) as Token),
      { k: '}' },
      ...tokens,
    ];
    const parser = new Parser(wrapped);
    return row(parser.list(() => false));
  }
  return row(new Parser(tokens).list(() => false));
}
