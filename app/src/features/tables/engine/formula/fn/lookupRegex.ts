// The regular expression test for XLOOKUP and XMATCH match mode 3. It never backtracks. The pattern compiles to a
// Thompson automaton that runs as a Pike machine, so the time is at most the program size times the text length, for
// every pattern. It reads JavaScript's syntax with the u flag. Back references and lookaround are refused (null), since
// no automaton can run them in linear time. A one-character piece (a class, an escape, or the dot) is tested by the
// built-in engine on one character, which cannot backtrack.

/** Longest pattern accepted. */
const PATTERN_MAX = 1000;
/** Most instructions a pattern may compile to, after counted repeats such as a{50} are written out. */
const PROGRAM_MAX = 5000;

type Assertion = '^' | '$' | 'b' | 'B';

type Node =
  | { t: 'char'; c: number }
  | { t: 'set'; re: RegExp }
  | { t: 'assert'; kind: Assertion }
  | { t: 'seq'; items: Node[] }
  | { t: 'alt'; items: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number };

const CHAR = 0;
const SET = 1;
const SPLIT = 2;
const JMP = 3;
const ASSERT = 4;
const MATCH = 5;

interface Inst {
  op: number;
  c: number;
  re: RegExp | null;
  kind: Assertion | null;
  x: number;
  y: number;
}

class Refused extends Error {}

/** A one-character test by the built-in engine. Anchored, so it reads exactly one character. */
function oneChar(src: string): Node {
  return { t: 'set', re: new RegExp(`^(?:${src})$`, 'u') };
}

/** Where the character class that starts at `i` ends. With the u flag, the first unescaped ] closes it. */
function classEnd(s: string, i: number): number {
  let j = i + 1;
  if (s[j] === '^') j++;
  while (j < s.length && s[j] !== ']') j += s[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** Parses a pattern the built-in engine has already accepted, so only refused forms need checking. */
class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): Node {
    const node = this.alt();
    if (this.i < this.s.length) throw new Refused();
    return node;
  }

  private alt(): Node {
    const items = [this.seq()];
    while (this.s[this.i] === '|') {
      this.i++;
      items.push(this.seq());
    }
    return items.length === 1 ? items[0] : { t: 'alt', items };
  }

  private seq(): Node {
    const items: Node[] = [];
    while (this.i < this.s.length && this.s[this.i] !== '|' && this.s[this.i] !== ')') {
      items.push(this.quantified(this.atom()));
    }
    return { t: 'seq', items };
  }

  private quantified(node: Node): Node {
    const s = this.s;
    let min: number;
    let max: number;
    const ch = s[this.i];
    if (ch === '*' || ch === '+' || ch === '?') {
      min = ch === '+' ? 1 : 0;
      max = ch === '?' ? 1 : Infinity;
      this.i++;
    } else if (ch === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(s.slice(this.i, this.i + 24));
      if (m === null) throw new Refused();
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      this.i += m[0].length;
    } else {
      return node;
    }
    // A lazy quantifier gives the same yes or no answer.
    if (s[this.i] === '?') this.i++;
    return { t: 'rep', node, min, max };
  }

  private atom(): Node {
    const s = this.s;
    const ch = s[this.i];
    if (ch === '(') {
      this.i++;
      if (s[this.i] === '?') {
        const named = s[this.i + 1] === '<' && s[this.i + 2] !== '=' && s[this.i + 2] !== '!';
        if (s[this.i + 1] === ':') this.i += 2;
        else if (named) this.i = s.indexOf('>', this.i) + 1;
        else throw new Refused();
      }
      const inner = this.alt();
      if (s[this.i] !== ')') throw new Refused();
      this.i++;
      return inner;
    }
    if (ch === '^' || ch === '$') {
      this.i++;
      return { t: 'assert', kind: ch };
    }
    if (ch === '.') {
      this.i++;
      return oneChar('.');
    }
    if (ch === '[') {
      const end = classEnd(s, this.i);
      const src = s.slice(this.i, end);
      this.i = end;
      return oneChar(src);
    }
    if (ch === '\\') return this.escape();
    const c = s.codePointAt(this.i) ?? 0;
    this.i += c > 0xffff ? 2 : 1;
    return { t: 'char', c };
  }

  private escape(): Node {
    const s = this.s;
    const start = this.i;
    const k = s[start + 1];
    if (k === 'b' || k === 'B') {
      this.i += 2;
      return { t: 'assert', kind: k };
    }
    if (k === 'k' || (k >= '1' && k <= '9')) throw new Refused();
    let end = start + 2;
    if ((k === 'u' && s[end] === '{') || k === 'p' || k === 'P') {
      end = s.indexOf('}', end) + 1;
    } else if (k === 'u') {
      end = start + 6;
      // A surrogate pair written as two escapes is one character with the u flag.
      if (
        /^\\u[dD][89abAB]/.test(s.slice(start, end)) &&
        /^\\u[dD][c-fC-F][0-9a-fA-F]{2}/.test(s.slice(end, end + 6))
      ) {
        end += 6;
      }
    } else if (k === 'x') {
      end = start + 4;
    } else if (k === 'c') {
      end = start + 3;
    }
    if (end <= start) throw new Refused();
    this.i = end;
    return oneChar(s.slice(start, end));
  }
}

/** Writes the program for a node: Thompson's construction. */
function compile(root: Node): Inst[] {
  const prog: Inst[] = [];
  const emit = (op: number, part: Partial<Inst> = {}): number => {
    if (prog.length >= PROGRAM_MAX) throw new Refused();
    prog.push({ op, c: 0, re: null, kind: null, x: 0, y: 0, ...part });
    return prog.length - 1;
  };
  const gen = (n: Node): void => {
    switch (n.t) {
      case 'char':
        emit(CHAR, { c: n.c });
        return;
      case 'set':
        emit(SET, { re: n.re });
        return;
      case 'assert':
        emit(ASSERT, { kind: n.kind });
        return;
      case 'seq':
        for (const item of n.items) gen(item);
        return;
      case 'alt': {
        const jumps: number[] = [];
        for (let k = 0; k < n.items.length - 1; k++) {
          const split = emit(SPLIT);
          prog[split].x = prog.length;
          gen(n.items[k]);
          jumps.push(emit(JMP));
          prog[split].y = prog.length;
        }
        gen(n.items[n.items.length - 1]);
        for (const j of jumps) prog[j].x = prog.length;
        return;
      }
      case 'rep': {
        for (let k = 0; k < n.min; k++) gen(n.node);
        if (n.max === Infinity) {
          const split = emit(SPLIT);
          prog[split].x = prog.length;
          gen(n.node);
          emit(JMP, { x: split });
          prog[split].y = prog.length;
          return;
        }
        const outs: number[] = [];
        for (let k = n.min; k < n.max; k++) {
          const split = emit(SPLIT);
          prog[split].x = prog.length;
          outs.push(split);
          gen(n.node);
        }
        for (const split of outs) prog[split].y = prog.length;
      }
    }
  };
  gen(root);
  emit(MATCH);
  return prog;
}

const isWord = (ch: string | undefined): boolean => ch !== undefined && /^\w$/.test(ch);

/** Whether the program matches anywhere in the text. Each step keeps at most one thread per instruction. */
function run(prog: readonly Inst[], text: string): boolean {
  const chars = Array.from(text);
  const n = chars.length;
  const size = prog.length;
  let cur = new Int32Array(size);
  let next = new Int32Array(size);
  const mark = new Int32Array(size).fill(-1);
  const stack = new Int32Array(size);

  const holds = (kind: Assertion | null, pos: number): boolean => {
    if (kind === '^') return pos === 0;
    if (kind === '$') return pos === n;
    const edge = isWord(chars[pos - 1]) !== isWord(chars[pos]);
    return kind === 'b' ? edge : !edge;
  };

  /** Adds the threads reachable from `from` without reading a character. -1 when one of them matches. */
  const close = (list: Int32Array, len: number, from: number, pos: number): number => {
    if (mark[from] === pos) return len;
    mark[from] = pos;
    stack[0] = from;
    let sp = 1;
    const push = (pc: number): void => {
      if (mark[pc] !== pos) {
        mark[pc] = pos;
        stack[sp++] = pc;
      }
    };
    while (sp > 0) {
      const pc = stack[--sp];
      const inst = prog[pc];
      if (inst.op === MATCH) return -1;
      if (inst.op === JMP) push(inst.x);
      else if (inst.op === SPLIT) {
        push(inst.y);
        push(inst.x);
      } else if (inst.op === ASSERT) {
        if (holds(inst.kind, pos)) push(pc + 1);
      } else list[len++] = pc;
    }
    return len;
  };

  let len = close(cur, 0, 0, 0);
  if (len < 0) return true;
  for (let pos = 0; pos < n; pos++) {
    const ch = chars[pos];
    const c = ch.codePointAt(0);
    let nextLen = 0;
    for (let k = 0; k < len; k++) {
      const inst = prog[cur[k]];
      const ok = inst.op === CHAR ? inst.c === c : inst.re !== null && inst.re.test(ch);
      if (!ok) continue;
      nextLen = close(next, nextLen, cur[k] + 1, pos + 1);
      if (nextLen < 0) return true;
    }
    // A match may start at any position.
    nextLen = close(next, nextLen, 0, pos + 1);
    if (nextLen < 0) return true;
    [cur, next] = [next, cur];
    len = nextLen;
  }
  return false;
}

/** A test that a text holds a match of `pattern` somewhere, or null for a pattern that is refused or not valid. */
export function regexMatcher(pattern: string): ((text: string) => boolean) | null {
  if (pattern.length > PATTERN_MAX) return null;
  try {
    // The built-in engine only checks the syntax here; it never runs on a text.
    new RegExp(pattern, 'u');
    const prog = compile(new Parser(pattern).parse());
    return (text) => run(prog, text);
  } catch {
    return null;
  }
}
