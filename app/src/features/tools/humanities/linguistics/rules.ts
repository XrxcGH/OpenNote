// Ordered phonological rules, written A -> B / C _ D, applied to underlying forms with a derivation table. The
// same engine applies historical sound changes in sequence. A, B, C, and D are segments, the classes V, and C,
// feature bundles such as [+voice -son], the word boundary #, and optional elements in parentheses. A rule applies
// at every place it matches in its input at once, as the usual simultaneous reading has it.
import { baseOf, featuresOf, matchesBundle, parseBundle, segmentWith, segments } from './features';
import type { Bundle, Inventory } from './features';

export type Element =
  | { kind: 'seg'; seg: string }
  | { kind: 'bundle'; bundle: Bundle; text: string }
  | { kind: 'boundary' }
  | { kind: 'optional'; items: Element[] };

export interface Rule {
  text: string;
  target: Element[];
  change: { kind: 'delete' } | { kind: 'segments'; segs: string[] } | { kind: 'features'; bundle: Bundle };
  /** Each way of reading the optional elements, as a left and a right context. */
  contexts: { left: Element[]; right: Element[] }[];
}

const EMPTY = /^(0|∅|Ø|ø̸)$/u;
const ARROW = /->|→|>/;

/** Reads a string of rule elements, splitting segments by the inventory. */
export function parseElements(text: string, inventory: Inventory): Element[] {
  const out: Element[] = [];
  const stack: Element[][] = [out];
  let i = 0;
  let plain = '';
  const flush = () => {
    if (plain === '') return;
    for (const seg of segments(plain, inventory)) stack[stack.length - 1].push({ kind: 'seg', seg });
    plain = '';
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '[') {
      flush();
      const end = text.indexOf(']', i);
      if (end < 0) throw new Error('bracket');
      const inner = text.slice(i, end + 1);
      stack[stack.length - 1].push({ kind: 'bundle', bundle: parseBundle(inner), text: inner });
      i = end + 1;
    } else if (c === '(') {
      flush();
      const group: Element[] = [];
      stack[stack.length - 1].push({ kind: 'optional', items: group });
      stack.push(group);
      i++;
    } else if (c === ')') {
      flush();
      if (stack.length === 1) throw new Error('bracket');
      stack.pop();
      i++;
    } else if (c === '#') {
      flush();
      stack[stack.length - 1].push({ kind: 'boundary' });
      i++;
    } else if (c === 'V' || c === 'C') {
      flush();
      stack[stack.length - 1].push({ kind: 'bundle', bundle: { syl: c === 'V' ? '+' : '-' }, text: c });
      i++;
    } else if (/\s/.test(c)) {
      flush();
      i++;
    } else {
      plain += c;
      i++;
    }
  }
  flush();
  if (stack.length !== 1) throw new Error('bracket');
  return out;
}

/** Every way of taking or leaving the optional elements, at most 16. */
function expand(elements: readonly Element[]): Element[][] {
  let ways: Element[][] = [[]];
  for (const el of elements) {
    if (el.kind === 'optional') {
      const inner = expand(el.items);
      ways = ways.flatMap((w) => [w, ...inner.map((x) => [...w, ...x])]);
    } else ways = ways.map((w) => [...w, el]);
    if (ways.length > 16) throw new Error('optional');
  }
  return ways;
}

export function parseRule(line: string, inventory: Inventory): Rule {
  const text = line.trim();
  const arrow = ARROW.exec(text);
  if (!arrow) throw new Error('arrow');
  const left = text.slice(0, arrow.index).trim();
  const rest = text.slice(arrow.index + arrow[0].length);
  const slash = rest.indexOf('/');
  const right = (slash < 0 ? rest : rest.slice(0, slash)).trim();
  const env = slash < 0 ? '_' : rest.slice(slash + 1).trim();
  const target = EMPTY.test(left) ? [] : parseElements(left, inventory);
  if (target.some((e) => e.kind === 'boundary' || e.kind === 'optional')) throw new Error('target');
  if (!EMPTY.test(left) && target.length === 0) throw new Error('target');
  let change: Rule['change'];
  if (EMPTY.test(right)) change = { kind: 'delete' };
  else if (right.startsWith('[')) {
    if (target.length !== 1) throw new Error('featureChange');
    change = { kind: 'features', bundle: parseBundle(right) };
  } else {
    const segs = segments(right, inventory);
    if (segs.length === 0) throw new Error('change');
    change = { kind: 'segments', segs };
  }
  if (target.length === 0 && change.kind !== 'segments') throw new Error('change');
  const parts = env.split('_');
  if (parts.length !== 2) throw new Error('focus');
  const lefts = expand(parseElements(parts[0], inventory));
  const rights = expand(parseElements(parts[1], inventory));
  const contexts = lefts.flatMap((l) => rights.map((r) => ({ left: l, right: r })));
  return { text, target, change, contexts };
}

const BOUND = '#';

function matchOne(el: Element, token: string | undefined, inventory: Inventory): boolean {
  if (token === undefined) return false;
  if (el.kind === 'boundary') return token === BOUND;
  if (token === BOUND) return false;
  if (el.kind === 'seg') return token === el.seg || baseOf(token, inventory) === el.seg;
  if (el.kind === 'bundle') return matchesBundle(featuresOf(token, inventory), el.bundle);
  return false;
}

const matchAt = (els: readonly Element[], w: readonly string[], at: number, inventory: Inventory) =>
  at >= 0 && els.every((el, k) => matchOne(el, w[at + k], inventory));

function changed(rule: Rule, token: string, inventory: Inventory): string[] {
  const { change } = rule;
  if (change.kind === 'delete') return [];
  if (change.kind === 'segments') return change.segs;
  const from = featuresOf(token, inventory);
  if (!from) throw new Error('unknownSegment');
  const seg = segmentWith({ ...from, ...change.bundle }, inventory);
  if (!seg) throw new Error('noSegment');
  const marks = [...token.normalize('NFD')].slice([...baseOf(token, inventory).normalize('NFD')].length).join('');
  return [(seg + marks).normalize('NFC')];
}

/** Applies a rule to a form's segments; returns the new segments. */
export function applyRule(rule: Rule, form: readonly string[], inventory: Inventory): string[] {
  const w = [BOUND, ...form, BOUND];
  const size = rule.target.length;
  const found = new Set<number>();
  for (let s = 1; s + size <= w.length - 1; s++) {
    if (!matchAt(rule.target, w, s, inventory)) continue;
    if (
      rule.contexts.some(
        (c) => matchAt(c.left, w, s - c.left.length, inventory) && matchAt(c.right, w, s + size, inventory),
      )
    ) {
      found.add(s);
    }
  }
  const out: string[] = [];
  let i = 1;
  while (i < w.length - 1 || (size === 0 && i === w.length - 1)) {
    if (found.has(i)) {
      if (size === 0) {
        out.push(...changed(rule, '', inventory));
        if (i < w.length - 1) out.push(w[i]);
        i++;
        continue;
      }
      const piece = w.slice(i, i + size);
      out.push(...(size === 1 ? changed(rule, piece[0], inventory) : changed(rule, piece.join(''), inventory)));
      i += size;
      continue;
    }
    if (i < w.length - 1) out.push(w[i]);
    i++;
  }
  return out;
}

export type Interaction = 'feeding' | 'bleeding' | 'counterfeeding' | 'counterbleeding';

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const applies = (rule: Rule, form: readonly string[], inv: Inventory) => !same(applyRule(rule, form, inv), form);

/** How an earlier rule A and a later rule B interact on a form as it stands before A. */
export function interaction(a: Rule, b: Rule, form: readonly string[], inv: Inventory): Interaction | null {
  const afterA = applyRule(a, form, inv);
  const bBefore = applies(b, form, inv);
  const bAfter = applies(b, afterA, inv);
  if (!bBefore && bAfter) return 'feeding';
  if (bBefore && !bAfter) return 'bleeding';
  const afterB = applyRule(b, form, inv);
  const aBefore = applies(a, form, inv);
  const aAfterB = applies(a, afterB, inv);
  if (!aBefore && aAfterB) return 'counterfeeding';
  if (aBefore && bBefore && !aAfterB) return 'counterbleeding';
  return null;
}

export interface Derivation {
  underlying: string;
  /** The form after each rule, or null where the rule did not change it. */
  stages: (string | null)[];
  surface: string;
  interactions: { first: number; second: number; kind: Interaction }[];
}

const strip = (form: string) => form.trim().replace(/^[/[]|[/\]]$/g, '');

/** Runs the rules in order over each form. Rules and forms are one a line. */
export function derive(
  ruleLines: string,
  formLines: string,
  inventory: Inventory,
): { rules: Rule[]; rows: Derivation[] } {
  const rules = ruleLines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => parseRule(l, inventory));
  const forms = formLines.split(/[\n,]/).map(strip).filter(Boolean);
  if (rules.length === 0) throw new Error('noRules');
  if (forms.length === 0) throw new Error('noForms');
  if (rules.length > 40 || forms.length > 100) throw new Error('tooMany');
  const rows = forms.map((underlying): Derivation => {
    let current = segments(underlying, inventory);
    const before: string[][] = [];
    const stages = rules.map((rule) => {
      before.push(current);
      const next = applyRule(rule, current, inventory);
      const result = same(next, current) ? null : next.join('');
      current = next;
      return result;
    });
    const interactions: Derivation['interactions'] = [];
    for (let k = 0; k + 1 < rules.length; k++) {
      const kind = interaction(rules[k], rules[k + 1], before[k], inventory);
      if (kind) interactions.push({ first: k + 1, second: k + 2, kind });
    }
    return { underlying, stages, surface: current.join(''), interactions };
  });
  return { rules, rows };
}
