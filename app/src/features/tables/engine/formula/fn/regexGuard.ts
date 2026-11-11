// A static guard for regular expressions. Owner: tables:fn-text.
//
// The JavaScript engine backtracks, so a pattern such as (a+)+$ takes time that doubles with each character of
// input, and a pattern with several adjacent open-ended parts takes time that grows as a power of the input length.
// A formula runs on the page's thread, so it must never start such a match. The guard reads the pattern, without
// running it, and refuses what can blow up. It is conservative: it may refuse a safe pattern, never admit a slow one
// of the kinds below.
//
// Refused: a back-reference; a repeated group whose body holds another repeat, a "?", or an alternation whose
// branches could start with the same character. Limited: with q repeating parts, the text may have at most the
// length whose (q + 1)th power is 1e9, since an unanchored search tries every start.

export type GuardProblem = 'regexBackreference' | 'regexNestedRepeat' | 'regexTooComplex';

interface Frame {
  /** The body holds a repeat or a "?". */
  quantified: boolean;
  /** The first literal character of each branch so far, or null for a branch that does not start with one. */
  heads: (string | null)[];
  /** Whether the next token is the first of its branch. */
  atBranchStart: boolean;
  clash: boolean;
}

const BACKSLASH = String.fromCharCode(92);

const frame = (): Frame => ({ quantified: false, heads: [], atBranchStart: true, clash: false });

/** Work budget: the (q + 1)th power of the input length may not pass this. */
const BUDGET = 1e9;

/** The most input characters a pattern with `repeats` repeating parts may be matched against. */
export function guardInputLimit(repeats: number): number {
  if (repeats === 0) return Infinity;
  return Math.floor(BUDGET ** (1 / (repeats + 1)) + 1e-6);
}

/** Reads a quantifier at `i`; gives its length, whether it repeats, and whether it only makes a part optional. */
function quantifierAt(p: string, i: number): { len: number; repeats: boolean; optional: boolean } | null {
  const c = p[i];
  if (c === '*' || c === '+') return { len: 1, repeats: true, optional: false };
  if (c === '?') return { len: 1, repeats: false, optional: true };
  if (c !== '{') return null;
  const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(p.slice(i, i + 24));
  if (m === null) return null;
  const min = Number(m[1]);
  const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
  return { len: m[0].length, repeats: max > min, optional: min === 0 && max <= 1 };
}

/** The refusal for a pattern, or the number of repeating parts it holds. */
export function guardPattern(pattern: string): GuardProblem | number {
  const stack: Frame[] = [frame()];
  let repeats = 0;
  let i = 0;
  const top = (): Frame => stack[stack.length - 1];
  const head = (h: string | null): void => {
    const f = top();
    if (!f.atBranchStart) return;
    f.atBranchStart = false;
    if (f.heads.length > 0 && (h === null || f.heads.includes(null) || f.heads.includes(h))) f.clash = true;
    f.heads.push(h);
  };
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === BACKSLASH) {
      const n = pattern[i + 1] ?? '';
      if (/[1-9]/.test(n) || (n === 'k' && pattern[i + 2] === '<')) return 'regexBackreference';
      head(null);
      i += 2;
    } else if (c === '[') {
      head(null);
      // Skip the class; "v" mode classes nest, so count depth.
      let depth = 0;
      for (; i < pattern.length; i++) {
        if (pattern[i] === BACKSLASH) i++;
        else if (pattern[i] === '[') depth++;
        else if (pattern[i] === ']' && --depth === 0) {
          i++;
          break;
        }
      }
    } else if (c === '(') {
      head(null);
      stack.push(frame());
      i++;
      if (pattern[i] === '?') {
        // (?:  (?=  (?!  (?<=  (?<!  (?<name>  (?i:  all open a group; skip the marker.
        const m = /^\?(?:<[A-Za-z_$][\w$]*>|<[=!]|[:=!]|[a-z-]*:)/.exec(pattern.slice(i, i + 40));
        i += m === null ? 1 : m[0].length;
      }
    } else if (c === ')') {
      if (stack.length === 1) return 'regexTooComplex';
      const body = stack.pop() as Frame;
      i++;
      const q = quantifierAt(pattern, i);
      if (q !== null) {
        if (q.repeats && (body.quantified || body.clash)) return 'regexNestedRepeat';
        if (q.repeats) repeats++;
        top().quantified = true;
        i += q.len;
        if (pattern[i] === '?') i++;
      }
      if (body.quantified) top().quantified = true;
      if (body.clash) top().clash = true;
    } else if (c === '|') {
      const f = top();
      f.atBranchStart = true;
      i++;
    } else {
      const q = quantifierAt(pattern, i);
      if (q !== null) {
        if (q.repeats) repeats++;
        top().quantified = true;
        i += q.len;
        if (pattern[i] === '?') i++;
      } else {
        head(c === '.' || c === '^' || c === '$' ? null : c);
        i++;
      }
    }
  }
  return stack.length === 1 ? repeats : 'regexTooComplex';
}
