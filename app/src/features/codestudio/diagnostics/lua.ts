// The Lua scope checker (layer L-b, DESIGN 6.1). Lua has no Lezer grammar in the app (the editor uses a legacy
// mode), so this reads tokens. It reports a read of a name that no `local` declares, that the file never assigns as
// a global, and that the Lua 5.4 standard library does not define, and a local that is never read. The codes are
// luacheck's: W113 accessing an undefined variable, W211 unused variable.

import type { Finding } from './types';

interface Token {
  kind: 'name' | 'keyword' | 'string' | 'number' | 'op';
  text: string;
  from: number;
  to: number;
  line: number;
}

interface Local {
  name: string;
  from: number;
  to: number;
  reads: number;
  report: boolean;
}

/** The global names of the Lua 5.4 reference manual, section 6, plus `unpack` and `arg`, which scripts expect. */
const LUA_GLOBALS = new Set(
  (
    '_G _VERSION assert collectgarbage dofile error getmetatable ipairs load loadfile next pairs pcall print ' +
    'rawequal rawget rawlen rawset require select setmetatable tonumber tostring type warn xpcall coroutine debug ' +
    'io math os package string table utf8 unpack arg'
  ).split(' '),
);

const KEYWORDS = new Set(
  'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(
    ' ',
  ),
);
const OPS = ['...', '..', '==', '~=', '<=', '>=', '//', '::', '<<', '>>'];
/** Token kinds that end an expression: a name right after one starts a new statement, even on the same line. */
const ENDS_EXPRESSION = new Set(['name', 'string', 'number']);
const ENDS_EXPRESSION_TEXT = /^(?:[)\]}]|true|false|nil|\.\.\.)$/;
/** Keywords that start a statement, so a pending `local` on the same line is in scope after them. */
const STATEMENT_KEYWORDS = /^(?:return|if|while|for|local|do|repeat|break|goto|end|else|elseif|until)$/;

function longBracket(text: string, at: number): number {
  const m = /^\[(=*)\[/.exec(text.slice(at, at + 64));
  if (!m) return -1;
  const close = text.indexOf(`]${m[1]}]`, at + m[0].length);
  return close < 0 ? text.length : close + m[1].length + 2;
}

export function tokenizeLua(text: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  const push = (kind: Token['kind'], from: number, to: number) => {
    tokens.push({ kind, text: text.slice(from, to), from, to, line });
    for (let k = from; k < to; k += 1) if (text.charCodeAt(k) === 10) line += 1;
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') {
      line += 1;
      i += 1;
    } else if (/\s/.test(ch)) i += 1;
    else if (text.startsWith('--', i)) {
      const end = longBracket(text, i + 2);
      const stop = end >= 0 ? end : text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
      for (let k = i; k < stop; k += 1) if (text.charCodeAt(k) === 10) line += 1;
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      push('string', i, (i = Math.min(text.length, j + 1)));
    } else if (ch === '[' && longBracket(text, i) >= 0) {
      push('string', i, (i = longBracket(text, i)));
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_]\w*/.exec(text.slice(i, i + 256))![0];
      push(KEYWORDS.has(m) ? 'keyword' : 'name', i, (i += m.length));
    } else if (/\d/.test(ch) || (ch === '.' && /\d/.test(text[i + 1] ?? ''))) {
      const m = /^(?:0[xX][\da-fA-F.]+(?:[pP][+-]?\d+)?|[\d.]+(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 128))![0];
      push('number', i, (i += m.length));
    } else {
      const op = OPS.find((o) => text.startsWith(o, i)) ?? ch;
      push('op', i, (i += op.length));
    }
  }
  return tokens;
}

class LuaChecker {
  readonly findings: Finding[] = [];
  private readonly scopes: Map<string, Local>[] = [new Map()];
  private readonly locals: Local[] = [];
  private readonly globals = new Set<string>();
  private readonly unresolved: Token[] = [];
  /** Locals waiting for the end of their `local` statement, so `local x = x` reads the outer `x`. */
  private pending: { token: Token; report: boolean }[] = [];
  private pendingLine = 0;
  private braces = 0;
  /** Loops whose `do` is still to come: a `for` has its scope already, a `while` gets one at `do`. */
  private readonly loops: ('for' | 'while')[] = [];
  private repeatUntil = -1;

  constructor(private readonly tokens: Token[]) {}

  private declare(token: Token, report: boolean): void {
    const local: Local = {
      name: token.text,
      from: token.from,
      to: token.to,
      reads: 0,
      report: report && token.text !== '_',
    };
    this.scopes[this.scopes.length - 1].set(token.text, local);
    this.locals.push(local);
  }

  private flushPending(): void {
    for (const p of this.pending) this.declare(p.token, p.report);
    this.pending = [];
  }

  private lookup(name: string): Local | undefined {
    for (let s = this.scopes.length - 1; s >= 0; s -= 1) {
      const found = this.scopes[s].get(name);
      if (found) return found;
    }
    return undefined;
  }

  private statementStart(i: number): boolean {
    const prev = this.tokens[i - 1];
    if (!prev) return true;
    if (prev.text === ';' || (prev.kind === 'keyword' && /^(?:do|then|else|end|repeat|break|local)$/.test(prev.text)))
      return true;
    // No expression has a name right after a name, a literal, or a closing bracket. So `x = false\ny = 0` and the
    // one-line bodies `function init() state = 1 end` and `do local v = 1 print(v) end` start statements there.
    return ENDS_EXPRESSION.has(prev.kind) || ENDS_EXPRESSION_TEXT.test(prev.text);
  }

  private startsStatement(i: number): boolean {
    const tok = this.tokens[i];
    if (tok.kind === 'keyword') return STATEMENT_KEYWORDS.test(tok.text);
    return tok.kind === 'name' && this.statementStart(i);
  }

  /** True when the name at `i` starts `a, b = ...` or `a = ...`. */
  private assignmentTarget(i: number): boolean {
    if (!this.statementStart(i)) return false;
    let j = i + 1;
    while (this.tokens[j]?.text === ',' && this.tokens[j + 1]?.kind === 'name') j += 2;
    return this.tokens[j]?.text === '=';
  }

  private params(i: number): number {
    let j = i;
    while (j < this.tokens.length && this.tokens[j].text !== '(') j += 1;
    this.scopes.push(new Map());
    for (j += 1; j < this.tokens.length && this.tokens[j].text !== ')'; j += 1) {
      if (this.tokens[j].kind === 'name') this.declare(this.tokens[j], false);
    }
    return j;
  }

  run(): void {
    const t = this.tokens;
    for (let i = 0; i < t.length; i += 1) {
      const tok = t[i];
      if (this.pending.length && (tok.line > this.pendingLine || tok.text === ';' || this.startsStatement(i))) {
        this.flushPending();
      }
      if (this.repeatUntil >= 0 && tok.line > this.repeatUntil) {
        this.scopes.pop();
        this.repeatUntil = -1;
      }
      if (tok.text === '{') this.braces += 1;
      else if (tok.text === '}') this.braces = Math.max(0, this.braces - 1);
      if (tok.kind === 'keyword') {
        i = this.keyword(i);
        continue;
      }
      if (tok.kind !== 'name') continue;
      const prev = t[i - 1]?.text;
      const next = t[i + 1]?.text;
      if (prev === '.' || prev === ':' || prev === '::' || prev === 'goto') continue;
      if (this.braces > 0 && next === '=' && (prev === '{' || prev === ',' || prev === ';')) continue;
      const local = this.lookup(tok.text);
      if (this.assignmentTarget(i)) {
        if (!local) this.globals.add(tok.text);
        continue;
      }
      if (local) local.reads += 1;
      else this.unresolved.push(tok);
    }
    this.flushPending();
    for (const tok of this.unresolved) {
      if (!this.globals.has(tok.text) && !LUA_GLOBALS.has(tok.text)) {
        this.findings.push({
          from: tok.from,
          to: tok.to,
          severity: 'warning',
          code: 'W113',
          message: 'luaUndefined',
          params: { name: tok.text },
        });
      }
    }
    for (const l of this.locals) {
      if (l.report && l.reads === 0) {
        this.findings.push({
          from: l.from,
          to: l.to,
          severity: 'warning',
          code: 'W211',
          message: 'luaUnused',
          params: { name: l.name },
        });
      }
    }
    this.findings.sort((a, b) => a.from - b.from);
  }

  /** Handles a keyword at `i` and returns the index of the last token it used. */
  private keyword(i: number): number {
    const t = this.tokens;
    switch (t[i].text) {
      case 'local': {
        if (t[i + 1]?.text === 'function' && t[i + 2]?.kind === 'name') {
          this.declare(t[i + 2], true);
          return this.params(i + 3);
        }
        let j = i + 1;
        while (t[j]?.kind === 'name') {
          this.pending.push({ token: t[j], report: true });
          j += 1;
          if (t[j]?.text === '<') j += 3;
          if (t[j]?.text !== ',') break;
          j += 1;
        }
        this.pendingLine = t[i].line;
        return j - 1;
      }
      case 'function': {
        let j = i + 1;
        const name = t[j];
        if (name?.kind === 'name') {
          const local = this.lookup(name.text);
          const plain = t[j + 1]?.text === '(';
          if (local) local.reads += plain ? 0 : 1;
          else if (plain) this.globals.add(name.text);
          else this.unresolved.push(name);
          while (t[j + 1]?.text === '.' || t[j + 1]?.text === ':') j += 2;
        }
        const method = t[j]?.text !== undefined && t[j - 1]?.text === ':';
        const end = this.params(j);
        if (method) this.declare({ ...t[j], text: 'self' }, false);
        return end;
      }
      case 'for': {
        this.scopes.push(new Map());
        this.loops.push('for');
        let j = i + 1;
        while (t[j]?.kind === 'name') {
          this.declare(t[j], false);
          j += t[j + 1]?.text === ',' ? 2 : 1;
        }
        return j - 1;
      }
      case 'while':
        this.loops.push('while');
        return i;
      case 'do':
        if (this.loops.pop() !== 'for') this.scopes.push(new Map());
        return i;
      case 'then':
      case 'repeat':
        this.scopes.push(new Map());
        return i;
      case 'elseif':
      case 'else':
        this.scopes.pop();
        if (t[i].text === 'else') this.scopes.push(new Map());
        return i;
      case 'until':
        this.repeatUntil = t[i].line;
        return i;
      case 'end':
        if (this.scopes.length > 1) this.scopes.pop();
        return i;
      default:
        return i;
    }
  }
}

/** The Lua checker's findings. */
export function checkLua(text: string): Finding[] {
  const checker = new LuaChecker(tokenizeLua(text));
  checker.run();
  return checker.findings;
}
