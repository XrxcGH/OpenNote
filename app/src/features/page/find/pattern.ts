// How a Find query becomes a regular expression. There are three modes. Plain text escapes the query and understands
// the special characters of Word's Find (^t, ^l, ^s, ^?, ^#, ^$, ^p, ^^). Wildcards are Word's wildcard language
// (?, *, [abc], [!abc], <, >, {n,m}, @). Regular expressions pass the query to the engine as written. Regular
// expressions and wildcards are limited: a pattern is short, and a repeated group that can repeat inside itself is
// refused, because those are the patterns that take exponential time. The limits are written from the documented
// behavior of regular expressions, not copied from any editor.

export interface PatternOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Treat the query as a regular expression. */
  regex?: boolean;
  /** Treat the query as Word-style wildcards. Ignored when `regex` is on. */
  wildcards?: boolean;
}

/** Why a query cannot be searched: the key of its message in `textFind.problem`. */
export type PatternProblem = 'tooLong' | 'invalid' | 'unsafe';

/** The longest regular expression or wildcard query, in characters. */
export const MAX_PATTERN_LENGTH = 250;

/** The paragraph mark: the end of a textblock, searched as one extra character after its text. */
export const PARAGRAPH_MARK = '\n';
/** A manual line break (a hard break node), as it stands in the searched text. */
export const LINE_BREAK = '\u000b';
/** What stands for any other node that is not text, such as an equation or an image. */
export const LEAF = '￼';

const NBSP = String.fromCharCode(0xa0);
const WORD_CHAR = '[\\p{L}\\p{N}_]';

const escapeChar = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The pattern each special character of plain text stands for. */
const SPECIAL: Readonly<Record<string, string>> = {
  t: '\\t',
  l: LINE_BREAK,
  s: NBSP,
  '?': '[^\\n]',
  '#': '\\p{Nd}',
  $: '\\p{L}',
  p: '\\n',
  '^': '\\^',
};

function plainSource(query: string): string {
  let out = '';
  for (let i = 0; i < query.length; i += 1) {
    const char = query[i];
    const special = char === '^' ? SPECIAL[query[i + 1]] : undefined;
    if (special !== undefined) {
      out += special;
      i += 1;
    } else out += escapeChar(char);
  }
  return out;
}

/** Word-style wildcards as a pattern, or null when the query is malformed (an unclosed bracket or brace). */
function wildcardSource(query: string): string | null {
  let out = '';
  for (let i = 0; i < query.length; i += 1) {
    const char = query[i];
    if (char === '\\') {
      i += 1;
      if (i >= query.length) return null;
      out += escapeChar(query[i]);
    } else if (char === '^' && SPECIAL[query[i + 1]] !== undefined) {
      out += SPECIAL[query[i + 1]];
      i += 1;
    } else if (char === '?') out += '[^\\n]';
    else if (char === '*') out += '[^\\n]*?';
    else if (char === '<') out += `(?<!${WORD_CHAR})(?=${WORD_CHAR})`;
    else if (char === '>') out += `(?<=${WORD_CHAR})(?!${WORD_CHAR})`;
    else if (char === '@') out += '+';
    else if (char === '(' || char === ')') out += char;
    else if (char === '[') {
      const close = query.indexOf(']', i + 2);
      if (close < 0) return null;
      let set = query.slice(i + 1, close);
      const negate = set.startsWith('!');
      if (negate) set = set.slice(1);
      out += `[${negate ? '^' : ''}${set.replace(/[\\\]^]/g, '\\$&')}]`;
      i = close;
    } else if (char === '{') {
      const close = query.indexOf('}', i);
      const body = close < 0 ? '' : query.slice(i + 1, close);
      if (!/^(\d+|\d+,\d*|,\d+)$/.test(body)) return null;
      out += `{${body.startsWith(',') ? `0${body}` : body}}`;
      i = close;
    } else out += escapeChar(char);
  }
  return out;
}

/** Whether a regular expression has a repeated part that repeats or chooses inside itself, such as `(a+)+`. */
export function isUnsafeRegex(source: string): boolean {
  // Each open group: whether it holds a repeat or an alternative.
  const stack: { repeats: boolean; chooses: boolean }[] = [];
  const quantifierAt = (at: number): { repeat: boolean; count?: number; end: number } | null => {
    const char = source[at];
    if (char === '*' || char === '+') return { repeat: true, end: at + 1 };
    if (char === '?') return { repeat: false, end: at + 1 };
    if (char !== '{') return null;
    const close = source.indexOf('}', at);
    const body = close < 0 ? '' : source.slice(at + 1, close);
    if (!/^\d+(,\d*)?$/.test(body)) return null;
    // `{3}` and `{0,1}` cannot grow without bound; anything else may.
    const count = /^\d+$/.test(body) ? Number(body) : 0;
    return { repeat: body !== '0,1' && count === 0 && !/^\d+$/.test(body), count, end: close + 1 };
  };
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      continue;
    }
    if (char === '[') inClass = true;
    else if (char === '(') {
      stack.push({ repeats: false, chooses: false });
      // A group such as (?: or (?<name> or (?= has its prefix skipped.
      if (source[i + 1] === '?') {
        const prefix = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(source.slice(i + 1));
        if (prefix) i += prefix[0].length;
      }
    } else if (char === '|') {
      const top = stack[stack.length - 1];
      if (top) top.chooses = true;
    } else if (char === ')') {
      const group = stack.pop();
      const quantifier = quantifierAt(i + 1);
      if (group && quantifier?.repeat && (group.repeats || group.chooses)) return true;
      // A group that repeats or chooses, taken a fixed number of times, still multiplies its work: `(.*a){12}`.
      const times = quantifier?.count ?? 0;
      if (group && ((times > 1 && group.repeats) || (times >= 8 && group.chooses))) return true;
      const parent = stack[stack.length - 1];
      if (parent && group) {
        parent.repeats ||= group.repeats || !!quantifier?.repeat;
        parent.chooses ||= group.chooses;
      }
    } else {
      const quantifier = quantifierAt(i);
      if (quantifier) {
        const top = stack[stack.length - 1];
        if (top && quantifier.repeat) top.repeats = true;
        i = quantifier.end - 1;
      }
    }
  }
  return false;
}

export type Compiled = { pattern: RegExp; problem?: undefined } | { pattern?: undefined; problem: PatternProblem };

/** The regular expression of a query, or why there is none. An empty query has none and no problem. */
export function compilePattern(query: string, options: PatternOptions): Compiled | null {
  if (query === '') return null;
  let body: string | null;
  if (options.regex) body = query;
  else if (options.wildcards) body = wildcardSource(query);
  else body = plainSource(query);
  if (body === null) return { problem: 'invalid' };
  if ((options.regex || options.wildcards) && query.length > MAX_PATTERN_LENGTH) return { problem: 'tooLong' };
  if ((options.regex || options.wildcards) && isUnsafeRegex(body)) return { problem: 'unsafe' };
  const source = options.wholeWord ? `(?<!${WORD_CHAR})(?:${body})(?!${WORD_CHAR})` : body;
  try {
    // The `m` flag lets ^ and $ match at the start and end of a paragraph, which is a line of the searched text.
    // Wildcards always match case, as Word's do, whatever the Match case switch says.
    const matchCase = options.caseSensitive || (!!options.wildcards && !options.regex);
    return { pattern: new RegExp(source, `g${matchCase ? '' : 'i'}mu`) };
  } catch {
    return { problem: 'invalid' };
  }
}

/** The problem with a query, or null when it can be searched. */
export function patternProblem(query: string, options: PatternOptions): PatternProblem | null {
  return compilePattern(query, options)?.problem ?? null;
}

/**
 * The text a match is replaced with. Plain text and wildcards understand ^t, ^l, ^s, ^^ and ^& (the found text);
 * wildcards also take \1 to \9 for the parenthesized parts. Regular expressions take $1 to $9, $& and $$.
 */
export function expandReplacement(text: string, groups: readonly string[], options: PatternOptions): string {
  const found = groups[0] ?? '';
  const digit = (next: string) => (/[1-9]/.test(next) ? (groups[Number(next)] ?? '') : null);
  const named: Readonly<Record<string, string>> = { t: '\t', l: LINE_BREAK, s: '\u00a0', '^': '^', '&': found };
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1] ?? '';
    let value: string | null = null;
    if (options.regex) {
      if (char === '$') value = next === '$' ? '$' : next === '&' ? found : digit(next);
    } else if (char === '^') value = named[next] ?? null;
    else if (options.wildcards && char === '\\') value = digit(next);
    if (value === null) out += char;
    else {
      out += value;
      i += 1;
    }
  }
  return out;
}
