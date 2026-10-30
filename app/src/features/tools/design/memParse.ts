// checks-disable-file modifiability: the parser is one recursive-descent unit that shares its token state

// A small C++ subset: lexer and parser for the memory and pointer tracer. It builds a syntax tree for int, double,
// char and bool values, arrays, pointers, references, structs, new, and delete, control flow, and functions. Anything
// outside the subset is reported with its line number, never guessed at.

export class ParseError extends Error {
  constructor(
    public readonly line: number,
    public readonly detail: string,
    public readonly kind: 'syntax' | 'unsupported' = 'syntax',
  ) {
    super(detail);
  }
}

// ---------- types ----------

export type Ty =
  { k: 'int' | 'double' | 'char' | 'bool' | 'void' } | { k: 'ptr'; to: Ty } | { k: 'struct'; name: string };

export const INT: Ty = { k: 'int' };
export const DOUBLE: Ty = { k: 'double' };
export const CHAR: Ty = { k: 'char' };
export const BOOL: Ty = { k: 'bool' };
export const VOID: Ty = { k: 'void' };

export function tyText(t: Ty): string {
  switch (t.k) {
    case 'ptr':
      return `${tyText(t.to)}*`;
    case 'struct':
      return t.name;
    default:
      return t.k;
  }
}

export const sameTy = (a: Ty, b: Ty): boolean => tyText(a) === tyText(b);

// ---------- tokens ----------

type Tok = { t: 'id' | 'num' | 'chr' | 'str' | 'p' | 'eof'; s: string; line: number; isFloat?: boolean };

const PUNCT = [
  '<<=',
  '>>=',
  '->',
  '++',
  '--',
  '<<',
  '>>',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '::',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '!',
  '~',
  '&',
  '|',
  '^',
  '?',
  ':',
  ';',
  ',',
  '.',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
];

const ESC: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  '0': 0,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
  '\\': 92,
  "'": 39,
  '"': 34,
};

function unescape(body: string, line: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== '\\') {
      out.push(c.charCodeAt(0));
      continue;
    }
    const n = body[++i];
    if (n === undefined || ESC[n] === undefined) throw new ParseError(line, `escape \\${n ?? ''}`, 'unsupported');
    out.push(ESC[n]!);
  }
  return out;
}

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
    } else if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      toks.push({ t: 'id', s: src.slice(i, j), line });
      i = j;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      let isFloat = false;
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j]!)) j++;
      } else {
        while (j < n && /[0-9]/.test(src[j]!)) j++;
        if (src[j] === '.') {
          isFloat = true;
          j++;
          while (j < n && /[0-9]/.test(src[j]!)) j++;
        }
        if (/[eE]/.test(src[j] ?? '')) {
          isFloat = true;
          j++;
          if (/[+-]/.test(src[j] ?? '')) j++;
          while (j < n && /[0-9]/.test(src[j]!)) j++;
        }
      }
      toks.push({ t: 'num', s: src.slice(i, j), line, isFloat });
      i = j;
      if (/[uUlLfF]/.test(src[i] ?? '')) throw new ParseError(line, 'number suffix', 'unsupported');
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        if (src[j] === '\n') throw new ParseError(line, 'unterminated literal');
        j++;
      }
      if (j >= n) throw new ParseError(line, 'unterminated literal');
      toks.push({ t: c === '"' ? 'str' : 'chr', s: src.slice(i + 1, j), line });
      i = j + 1;
    } else {
      const p = PUNCT.find((q) => src.startsWith(q, i));
      if (!p) throw new ParseError(line, `character ${c}`, 'unsupported');
      toks.push({ t: 'p', s: p, line });
      i += p.length;
    }
  }
  toks.push({ t: 'eof', s: '', line });
  return toks;
}

// ---------- syntax tree ----------

export type Expr = { line: number } & (
  | { e: 'num'; v: number; dbl: boolean }
  | { e: 'chr'; v: number }
  | { e: 'str'; v: number[] }
  | { e: 'bool'; v: boolean }
  | { e: 'null' }
  | { e: 'id'; name: string }
  | { e: 'un'; op: string; x: Expr }
  | { e: 'post'; op: string; x: Expr }
  | { e: 'bin'; op: string; l: Expr; r: Expr }
  | { e: 'assign'; op: string; l: Expr; r: Expr }
  | { e: 'cond'; c: Expr; a: Expr; b: Expr }
  | { e: 'call'; name: string; args: Expr[] }
  | { e: 'index'; x: Expr; i: Expr }
  | { e: 'member'; x: Expr; field: string; arrow: boolean }
  | { e: 'sizeofT'; ty: Ty }
  | { e: 'sizeofE'; x: Expr }
  | { e: 'new'; ty: Ty; init?: Expr; count?: Expr; parens: boolean }
  | { e: 'cast'; ty: Ty; x: Expr }
);

export interface Declarator {
  name: string;
  ty: Ty;
  ref: boolean;
  /** Array length expression, or 'infer' for `[]` with an initializer list. */
  size?: Expr | 'infer';
  init?: Expr;
  list?: Expr[];
  line: number;
}

export type Stmt = { line: number } & (
  | { s: 'decl'; decls: Declarator[] }
  | { s: 'expr'; x: Expr }
  | { s: 'block'; body: Stmt[] }
  | { s: 'if'; c: Expr; a: Stmt; b?: Stmt }
  | { s: 'while'; c: Expr; body: Stmt }
  | { s: 'do'; c: Expr; body: Stmt }
  | { s: 'for'; init?: Stmt; c?: Expr; step?: Expr; body: Stmt }
  | { s: 'return'; x?: Expr }
  | { s: 'break' }
  | { s: 'continue' }
  | { s: 'delete'; x: Expr; array: boolean }
  | { s: 'empty' }
);

export interface Param {
  name: string;
  ty: Ty;
  ref: boolean;
}

export interface Func {
  name: string;
  ret: Ty;
  params: Param[];
  body: Stmt[];
  line: number;
}

export interface StructDef {
  name: string;
  fields: { name: string; ty: Ty; count?: number }[];
  line: number;
}

export interface Program {
  structs: Map<string, StructDef>;
  funcs: Map<string, Func>;
  items: Stmt[];
}

const BASE = new Set(['int', 'double', 'char', 'bool', 'void']);
const UNSUPPORTED_TYPES = new Set([
  'float',
  'long',
  'short',
  'unsigned',
  'signed',
  'auto',
  'string',
  'vector',
  'map',
  'set',
  'wchar_t',
  'size_t',
  'int8_t',
  'int16_t',
  'int32_t',
  'int64_t',
  'uint8_t',
  'uint16_t',
  'uint32_t',
  'uint64_t',
]);
const UNSUPPORTED_WORDS = new Set([
  'class',
  'template',
  'typedef',
  'using_',
  'switch',
  'case',
  'goto',
  'try',
  'catch',
  'throw',
  'namespace',
  'virtual',
  'operator',
  'static',
  'extern',
  'enum',
  'union',
  'cin',
  'printf',
  'scanf',
  'malloc',
  'free',
  'this',
  'public',
  'private',
  'protected',
  'inline',
  'constexpr',
  'typeid',
]);

const BINARY: string[][] = [
  ['||'],
  ['&&'],
  ['|'],
  ['^'],
  ['&'],
  ['==', '!='],
  ['<', '>', '<=', '>='],
  ['<<', '>>'],
  ['+', '-'],
  ['*', '/', '%'],
];
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export function parse(src: string): Program {
  const toks = lex(src);
  let pos = 0;
  const program: Program = { structs: new Map(), funcs: new Map(), items: [] };
  const peek = (o = 0): Tok => toks[Math.min(pos + o, toks.length - 1)]!;
  const next = (): Tok => toks[pos < toks.length - 1 ? pos++ : pos]!;
  const is = (s: string, o = 0): boolean => {
    const t = peek(o);
    return (t.t === 'p' || t.t === 'id') && t.s === s;
  };
  const accept = (s: string): boolean => {
    if (is(s)) {
      next();
      return true;
    }
    return false;
  };
  const expect = (s: string): Tok => {
    if (!is(s)) throw new ParseError(peek().line, `expected ${s}`);
    return next();
  };
  const ident = (): Tok => {
    const t = peek();
    if (t.t !== 'id') throw new ParseError(t.line, 'expected a name');
    return next();
  };

  const isTypeStart = (o = 0): boolean => {
    const t = peek(o);
    if (t.t !== 'id') return false;
    return (
      BASE.has(t.s) || t.s === 'const' || t.s === 'struct' || UNSUPPORTED_TYPES.has(t.s) || program.structs.has(t.s)
    );
  };

  /** Base type and pointer stars, e.g. `const Node**`. */
  function parseType(): Ty {
    let t = peek();
    while (is('const')) t = (next(), peek());
    if (t.t === 'id' && UNSUPPORTED_TYPES.has(t.s)) throw new ParseError(t.line, `type ${t.s}`, 'unsupported');
    let ty: Ty;
    if (is('struct')) {
      next();
      const n = ident();
      if (!program.structs.has(n.s)) throw new ParseError(n.line, `unknown struct ${n.s}`);
      ty = { k: 'struct', name: n.s };
    } else if (t.t === 'id' && BASE.has(t.s)) {
      next();
      ty = { k: t.s as 'int' | 'double' | 'char' | 'bool' | 'void' };
    } else if (t.t === 'id' && program.structs.has(t.s)) {
      next();
      ty = { k: 'struct', name: t.s };
    } else throw new ParseError(t.line, 'expected a type');
    while (is('const')) next();
    while (is('*')) {
      next();
      ty = { k: 'ptr', to: ty };
      while (is('const')) next();
    }
    return ty;
  }

  // ---- expressions ----
  function primary(): Expr {
    const t = peek();
    const line = t.line;
    if (t.t === 'num') {
      next();
      if (t.isFloat) return { e: 'num', v: Number(t.s), dbl: true, line };
      return { e: 'num', v: Number(t.s), dbl: false, line };
    }
    if (t.t === 'chr') {
      next();
      const v = unescape(t.s, line);
      if (v.length !== 1) throw new ParseError(line, 'character literal', 'unsupported');
      return { e: 'chr', v: v[0]!, line };
    }
    if (t.t === 'str') {
      next();
      let body = t.s;
      while (peek().t === 'str') body += next().s;
      return { e: 'str', v: unescape(body, line), line };
    }
    if (t.t === 'id') {
      if (UNSUPPORTED_WORDS.has(t.s) && t.s !== 'cin') throw new ParseError(line, `${t.s}`, 'unsupported');
      if (t.s === 'cin') throw new ParseError(line, 'cin (input)', 'unsupported');
      if (t.s === 'true' || t.s === 'false') return (next(), { e: 'bool', v: t.s === 'true', line });
      if (t.s === 'nullptr' || t.s === 'NULL') return (next(), { e: 'null', line });
      if (t.s === 'sizeof') {
        next();
        if (is('(') && isTypeStart(1)) {
          next();
          const ty = parseType();
          expect(')');
          return { e: 'sizeofT', ty, line };
        }
        return { e: 'sizeofE', x: unary(), line };
      }
      if (t.s === 'new') {
        next();
        const ty = parseType();
        if (is('[')) {
          next();
          const count = expr();
          expect(']');
          return { e: 'new', ty, count, parens: false, line };
        }
        if (is('(')) {
          next();
          if (accept(')')) return { e: 'new', ty, parens: true, line };
          const init = expr();
          expect(')');
          return { e: 'new', ty, init, parens: true, line };
        }
        return { e: 'new', ty, parens: false, line };
      }
      if (t.s === 'static_cast') {
        next();
        expect('<');
        const ty = parseType();
        expect('>');
        expect('(');
        const x = expr();
        expect(')');
        return { e: 'cast', ty, x, line };
      }
      next();
      if (t.s === 'std' && is('::')) {
        next();
        const n = ident();
        return { e: 'id', name: n.s, line };
      }
      if (is('(')) {
        next();
        const args: Expr[] = [];
        if (!is(')')) {
          do args.push(assignment());
          while (accept(','));
        }
        expect(')');
        return { e: 'call', name: t.s, args, line };
      }
      return { e: 'id', name: t.s, line };
    }
    if (is('(')) {
      next();
      const x = expr();
      expect(')');
      return x;
    }
    throw new ParseError(line, t.t === 'eof' ? 'unexpected end' : `unexpected ${t.s}`);
  }

  function postfix(): Expr {
    let x = primary();
    for (;;) {
      const line = peek().line;
      if (is('[')) {
        next();
        const i = expr();
        expect(']');
        x = { e: 'index', x, i, line };
      } else if (is('.') || is('->')) {
        const arrow = next().s === '->';
        x = { e: 'member', x, field: ident().s, arrow, line };
      } else if (is('++') || is('--')) {
        x = { e: 'post', op: next().s, x, line };
      } else return x;
    }
  }

  function unary(): Expr {
    const line = peek().line;
    if (is('(') && isTypeStart(1)) {
      next();
      const ty = parseType();
      expect(')');
      return { e: 'cast', ty, x: unary(), line };
    }
    for (const op of ['++', '--', '+', '-', '!', '~', '*', '&']) {
      if (is(op) && peek().t === 'p') {
        next();
        return { e: 'un', op, x: unary(), line };
      }
    }
    return postfix();
  }

  function binary(level: number): Expr {
    if (level >= BINARY.length) return unary();
    let l = binary(level + 1);
    for (;;) {
      const t = peek();
      if (t.t === 'p' && BINARY[level]!.includes(t.s)) {
        next();
        const r = binary(level + 1);
        l = { e: 'bin', op: t.s, l, r, line: t.line };
      } else return l;
    }
  }

  function conditional(): Expr {
    const c = binary(0);
    if (is('?')) {
      const line = next().line;
      const a = expr();
      expect(':');
      const b = conditional();
      return { e: 'cond', c, a, b, line };
    }
    return c;
  }

  function assignment(): Expr {
    const l = conditional();
    const t = peek();
    if (t.t === 'p' && ASSIGN.has(t.s)) {
      next();
      return { e: 'assign', op: t.s, l, r: assignment(), line: t.line };
    }
    return l;
  }

  function expr(): Expr {
    const x = assignment();
    if (is(',')) throw new ParseError(peek().line, 'the comma operator', 'unsupported');
    return x;
  }

  // ---- declarations and statements ----
  function declarators(base: Ty): Declarator[] {
    const out: Declarator[] = [];
    do {
      let ty = base;
      while (is('*')) {
        next();
        ty = { k: 'ptr', to: ty };
        while (is('const')) next();
      }
      let ref = false;
      if (is('&')) {
        next();
        ref = true;
      }
      const n = ident();
      const d: Declarator = { name: n.s, ty, ref, line: n.line };
      if (is('[')) {
        next();
        if (is(']')) d.size = 'infer';
        else d.size = expr();
        expect(']');
        if (is('[')) throw new ParseError(peek().line, 'arrays of arrays', 'unsupported');
      }
      if (accept('=')) {
        if (is('{')) {
          next();
          d.list = [];
          if (!is('}')) {
            do {
              if (is('}')) break;
              d.list.push(assignment());
            } while (accept(','));
          }
          expect('}');
        } else d.init = assignment();
      } else if (is('{')) {
        throw new ParseError(peek().line, 'brace initialization without =', 'unsupported');
      } else if (is('(')) {
        throw new ParseError(peek().line, 'constructor-style initialization', 'unsupported');
      }
      if (d.ref && d.init === undefined) throw new ParseError(n.line, 'a reference needs something to refer to');
      out.push(d);
    } while (accept(','));
    return out;
  }

  function declaration(): Stmt {
    const line = peek().line;
    const base = parseType();
    if (base.k === 'void' && !is('*')) throw new ParseError(line, 'a variable of type void');
    const decls = declarators(base);
    expect(';');
    return { s: 'decl', decls, line };
  }

  function statement(): Stmt {
    const t = peek();
    const line = t.line;
    if (t.t === 'id' && UNSUPPORTED_WORDS.has(t.s) && t.s !== 'using_') throw new ParseError(line, t.s, 'unsupported');
    if (t.t === 'id' && t.s === 'std' && is('::', 1) && UNSUPPORTED_TYPES.has(peek(2).s)) {
      throw new ParseError(line, `type ${peek(2).s}`, 'unsupported');
    }
    if (is('{')) return block();
    if (is(';')) return (next(), { s: 'empty', line });
    if (is('if')) {
      next();
      expect('(');
      const c = expr();
      expect(')');
      const a = statement();
      const b = accept('else') ? statement() : undefined;
      return b ? { s: 'if', c, a, b, line } : { s: 'if', c, a, line };
    }
    if (is('while')) {
      next();
      expect('(');
      const c = expr();
      expect(')');
      return { s: 'while', c, body: statement(), line };
    }
    if (is('do')) {
      next();
      const body = statement();
      expect('while');
      expect('(');
      const c = expr();
      expect(')');
      expect(';');
      return { s: 'do', c, body, line };
    }
    if (is('for')) {
      next();
      expect('(');
      let init: Stmt | undefined;
      if (is(';')) next();
      else if (isTypeStart()) init = declaration();
      else {
        const x = expr();
        expect(';');
        init = { s: 'expr', x, line };
      }
      const c = is(';') ? undefined : expr();
      expect(';');
      const step = is(')') ? undefined : expr();
      expect(')');
      const body = statement();
      return { s: 'for', ...(init ? { init } : {}), ...(c ? { c } : {}), ...(step ? { step } : {}), body, line };
    }
    if (is('return')) {
      next();
      const x = is(';') ? undefined : expr();
      expect(';');
      return x ? { s: 'return', x, line } : { s: 'return', line };
    }
    if (is('break')) return (next(), expect(';'), { s: 'break', line });
    if (is('continue')) return (next(), expect(';'), { s: 'continue', line });
    if (is('delete')) {
      next();
      let array = false;
      if (is('[')) {
        next();
        expect(']');
        array = true;
      }
      const x = unary();
      expect(';');
      return { s: 'delete', x, array, line };
    }
    if (is('using')) {
      // using namespace std;
      next();
      while (!is(';') && peek().t !== 'eof') next();
      expect(';');
      return { s: 'empty', line };
    }
    if (isTypeStart() && !(peek().t === 'id' && program.structs.has(peek().s) && is('(', 1))) return declaration();
    const x = expr();
    expect(';');
    return { s: 'expr', x, line };
  }

  function block(): Stmt {
    const line = expect('{').line;
    const body: Stmt[] = [];
    while (!is('}')) {
      if (peek().t === 'eof') throw new ParseError(line, 'a { is never closed');
      body.push(statement());
    }
    next();
    return { s: 'block', body, line };
  }

  function structDef(): void {
    const line = next().line; // struct
    const name = ident();
    if (!is('{')) {
      // `struct Foo x;` at top level is a declaration using an existing struct
      pos -= 2;
      program.items.push(declaration());
      return;
    }
    const def: StructDef = { name: name.s, fields: [], line };
    program.structs.set(name.s, def);
    next();
    while (!is('}')) {
      if (peek().t === 'eof') throw new ParseError(line, 'a { is never closed');
      const base = parseType();
      for (const d of declarators(base)) {
        if (d.ref) throw new ParseError(d.line, 'a reference member', 'unsupported');
        if (d.init || d.list) throw new ParseError(d.line, 'a default member value', 'unsupported');
        let count: number | undefined;
        if (d.size !== undefined) {
          if (d.size === 'infer' || d.size.e !== 'num')
            throw new ParseError(d.line, 'an array member needs a number size');
          count = d.size.v;
        }
        def.fields.push(count === undefined ? { name: d.name, ty: d.ty } : { name: d.name, ty: d.ty, count });
      }
      expect(';');
    }
    next();
    expect(';');
  }

  function params(): Param[] {
    const out: Param[] = [];
    if (is(')')) return out;
    if (is('void') && is(')', 1)) return (next(), out);
    do {
      const ty = parseType();
      let ref = false;
      if (is('&')) {
        next();
        ref = true;
      }
      const n = ident();
      if (is('[')) {
        next();
        if (!is(']')) expr();
        expect(']');
        out.push({ name: n.s, ty: { k: 'ptr', to: ty }, ref });
      } else out.push({ name: n.s, ty, ref });
    } while (accept(','));
    return out;
  }

  while (peek().t !== 'eof') {
    if (is('struct') && peek(1).t === 'id' && is('{', 2)) {
      structDef();
      continue;
    }
    // function definition or prototype: type name (
    if (isTypeStart()) {
      const save = pos;
      const ret = parseType();
      if (peek().t === 'id' && is('(', 1)) {
        const name = next();
        next();
        const ps = params();
        expect(')');
        if (accept(';')) continue;
        if (!is('{')) throw new ParseError(peek().line, 'expected { to start the function');
        const b = block();
        if (b.s !== 'block') throw new ParseError(name.line, 'function body');
        if (program.funcs.has(name.s)) throw new ParseError(name.line, `${name.s} is defined twice`);
        program.funcs.set(name.s, { name: name.s, ret, params: ps, body: b.body, line: name.line });
        continue;
      }
      pos = save;
    }
    program.items.push(statement());
  }
  return program;
}
