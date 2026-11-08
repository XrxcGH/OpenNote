// Regular expression functions. Owner: tables:fn-text. They run on the JavaScript engine's RegExp (plan decision 6),
// inside two limits: a pattern of at most 1,000 characters and an input of at most 32,768 characters. A call over
// either limit gives #VALUE!. The "v" flag is tried first, then "u", then none, so a pattern written for PCRE or RE2
// that the strict modes refuse still runs. Excel's functions take (text, pattern, ...); Sheets' REGEXMATCH and the
// two- and three-argument forms of REGEXEXTRACT and REGEXREPLACE are accepted too.

import { makeArray } from '../../arrays';
import { err, toNumber, toText, type FormulaError, type Scalar, type Value } from '../../values';
import type { FnSpec2, Param } from './types';

/** The longest pattern, in characters. */
export const REGEX_MAX_PATTERN = 1000;
/** The longest input text, in characters. */
export const REGEX_MAX_INPUT = 32768;

/** The limit a call breaks, named in words, or null when it is within both. */
export function regexLimitProblem(text: string, pattern: string): string | null {
  if (pattern.length > REGEX_MAX_PATTERN) return `a pattern over ${REGEX_MAX_PATTERN} characters`;
  if (text.length > REGEX_MAX_INPUT) return `an input over ${REGEX_MAX_INPUT} characters`;
  return null;
}

const CACHE = new Map<string, RegExp | null>();

function build(pattern: string, ignoreCase: boolean): RegExp | null {
  const key = `${ignoreCase ? 'i' : 's'}${pattern}`;
  const known = CACHE.get(key);
  if (known !== undefined) return known;
  let found: RegExp | null = null;
  for (const mode of ['v', 'u', '']) {
    try {
      found = new RegExp(pattern, `g${ignoreCase ? 'i' : ''}${mode}`);
      break;
    } catch {
      // Try the next, more lenient mode.
    }
  }
  if (CACHE.size > 200) CACHE.clear();
  CACHE.set(key, found);
  return found;
}

interface Prepared {
  text: string;
  re: RegExp;
}

/** The text and the compiled pattern, or the error to return. */
function prepare(t: Value, p: Value, caseMode: Value | undefined): Prepared | FormulaError {
  const text = toText(t);
  const pattern = toText(p);
  if (typeof text !== 'string') return text;
  if (typeof pattern !== 'string') return pattern;
  let ignoreCase = false;
  if (caseMode !== undefined) {
    const n = toNumber(caseMode);
    if (typeof n !== 'number') return n;
    if (n !== 0 && n !== 1) return err('VALUE');
    ignoreCase = n === 1;
  }
  if (regexLimitProblem(text, pattern) !== null) return err('VALUE');
  const re = build(pattern, ignoreCase);
  return re === null ? err('VALUE') : { text, re };
}

const isPrepared = (x: Prepared | FormulaError): x is Prepared => 're' in x;

function matches(prep: Prepared): RegExpMatchArray[] {
  return [...prep.text.matchAll(prep.re)];
}

/** The groups of one match, an unmatched optional group being empty text. */
const groupsOf = (m: RegExpMatchArray): string[] => m.slice(1).map((g) => g ?? '');

function row(items: readonly Scalar[]): Value {
  return items.length === 1 ? items[0] : makeArray(1, items.length, items);
}

function column(items: readonly Scalar[]): Value {
  return items.length === 1 ? items[0] : makeArray(items.length, 1, items);
}

/** Fills $1 to $99, $0 (the whole match), and $$ in a replacement. */
function expand(template: string, m: RegExpMatchArray): string {
  return template.replace(/\$(\$|\d{1,2})/g, (whole, token: string) => {
    if (token === '$') return '$';
    const n = Number(token);
    if (n < m.length) return m[n] ?? '';
    // $10 with fewer than ten groups reads as $1 and then a 0, as most engines do.
    if (token.length === 2 && Number(token[0]) < m.length) return (m[Number(token[0])] ?? '') + token[1];
    return whole;
  });
}

const text = (name: string): Param => ({ name, kind: 'text' });
const opt = (name: string): Param => ({ name, kind: 'number', optional: true });

export const functions: readonly FnSpec2[] = [
  {
    name: 'REGEXTEST',
    family: 'regex',
    params: [text('text'), text('pattern'), opt('case_sensitivity')],
    run: ([t, p, c]) => {
      const prep = prepare(t, p, c);
      if (!isPrepared(prep)) return prep;
      prep.re.lastIndex = 0;
      return prep.re.test(prep.text);
    },
    meta: { signature: 'REGEXTEST(text, pattern, [case_sensitivity])', example: '=REGEXTEST("abc", "^a") gives TRUE' },
  },
  {
    name: 'REGEXMATCH',
    family: 'regex',
    params: [text('text'), text('pattern')],
    run: ([t, p]) => {
      const prep = prepare(t, p, undefined);
      if (!isPrepared(prep)) return prep;
      prep.re.lastIndex = 0;
      return prep.re.test(prep.text);
    },
    meta: { signature: 'REGEXMATCH(text, pattern)', example: '=REGEXMATCH("note 12", "[0-9]+") gives TRUE' },
  },
  {
    name: 'REGEXEXTRACT',
    family: 'regex',
    params: [text('text'), text('pattern'), opt('return_mode'), opt('case_sensitivity')],
    run: (args) => {
      const [t, p, r, c] = args;
      const prep = prepare(t, p, c);
      if (!isPrepared(prep)) return prep;
      const mode = r === undefined ? null : toNumber(r);
      if (mode !== null && typeof mode !== 'number') return mode;
      if (mode !== null && ![0, 1, 2].includes(mode)) return err('VALUE');
      const all = matches(prep);
      if (all.length === 0) return err('NA');
      // Sheets' two-argument form gives the capturing groups when the pattern has any, and the match when not.
      if (args.length === 2) return all[0].length > 1 ? row(groupsOf(all[0])) : all[0][0];
      if (mode === 1) return column(all.map((m) => m[0]));
      if (mode === 2) return all[0].length > 1 ? row(groupsOf(all[0])) : err('VALUE');
      return all[0][0];
    },
    meta: {
      signature: 'REGEXEXTRACT(text, pattern, [return_mode], [case_sensitivity])',
      example: '=REGEXEXTRACT("abc123", "[0-9]+") gives 123',
    },
  },
  {
    name: 'REGEXREPLACE',
    family: 'regex',
    params: [text('text'), text('pattern'), text('replacement'), opt('occurrence'), opt('case_sensitivity')],
    run: ([t, p, rep, o, c]) => {
      const prep = prepare(t, p, c);
      if (!isPrepared(prep)) return prep;
      const replacement = toText(rep);
      if (typeof replacement !== 'string') return replacement;
      const occurrence = o === undefined ? 0 : toNumber(o);
      if (typeof occurrence !== 'number') return occurrence;
      const all = matches(prep);
      const n = Math.trunc(occurrence);
      const chosen = n === 0 ? all : [all[n > 0 ? n - 1 : all.length + n]].filter((m) => m !== undefined);
      let out = '';
      let at = 0;
      for (const m of chosen) {
        const start = m.index ?? 0;
        out += prep.text.slice(at, start) + expand(replacement, m);
        at = start + m[0].length;
      }
      out += prep.text.slice(at);
      return out.length > 32767 ? err('VALUE') : out;
    },
    meta: {
      signature: 'REGEXREPLACE(text, pattern, replacement, [occurrence], [case_sensitivity])',
      example: '=REGEXREPLACE("a1b2", "[0-9]", "#") gives a#b#',
    },
  },
];
