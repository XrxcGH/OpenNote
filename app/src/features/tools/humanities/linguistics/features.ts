// A distinctive feature chart written for this app from the usual articulatory descriptions of each sound, with
// binary features (+ or -) and 0 where a feature does not apply. The student can change or add segments by
// starting from one in the chart. Words are split into segments by the longest match, so tʃ is one segment, and
// diacritics such as ʰ or ː stay with the segment before them.

export const FEATURES = [
  'syl',
  'cons',
  'son',
  'cont',
  'delrel',
  'nas',
  'lat',
  'voi',
  'strid',
  'lab',
  'cor',
  'ant',
  'dor',
  'high',
  'low',
  'back',
  'round',
  'tense',
] as const;
export type Feature = (typeof FEATURES)[number];
export type Value = '+' | '-' | '0';
export type Bundle = Partial<Record<Feature, Value>>;
export type Inventory = Map<string, Record<Feature, Value>>;

const NAMES: Record<string, Feature> = {
  syllabic: 'syl',
  consonantal: 'cons',
  sonorant: 'son',
  continuant: 'cont',
  delayedrelease: 'delrel',
  dr: 'delrel',
  nasal: 'nas',
  lateral: 'lat',
  voice: 'voi',
  voiced: 'voi',
  strident: 'strid',
  labial: 'lab',
  coronal: 'cor',
  anterior: 'ant',
  dorsal: 'dor',
  hi: 'high',
  lo: 'low',
  bk: 'back',
  rd: 'round',
  rnd: 'round',
  tns: 'tense',
};

/** A feature by its short or full name, such as voi, voice, or voiced. */
export function featureName(text: string): Feature {
  const key = text.toLowerCase().replace(/[\s_-]/g, '');
  if ((FEATURES as readonly string[]).includes(key)) return key as Feature;
  const found = NAMES[key];
  if (!found) throw new Error('feature');
  return found;
}

const all = (value: Value): Record<Feature, Value> =>
  Object.fromEntries(FEATURES.map((f) => [f, value])) as Record<Feature, Value>;

const CONSONANT: Record<Feature, Value> = {
  ...all('-'),
  cons: '+',
  ant: '0',
  high: '0',
  low: '0',
  back: '0',
  round: '0',
  tense: '0',
};
const VOWEL: Record<Feature, Value> = {
  ...all('0'),
  syl: '+',
  cons: '-',
  son: '+',
  cont: '+',
  delrel: '-',
  nas: '-',
  lat: '-',
  voi: '+',
};

const DORSAL: Bundle = { dor: '+', high: '+', low: '-', back: '+' };
const ALVEOLAR: Bundle = { cor: '+', ant: '+' };
const POSTALVEOLAR: Bundle = { cor: '+', ant: '-' };
const VOICED: Bundle = { voi: '+' };
const NASAL: Bundle = { son: '+', nas: '+', voi: '+' };
const LIQUID: Bundle = { son: '+', cont: '+', voi: '+', ...ALVEOLAR };

const C = (...parts: Bundle[]) => Object.assign({ ...CONSONANT }, ...parts) as Record<Feature, Value>;
const V = (high: Value, low: Value, back: Value, round: Value, tense: Value) =>
  ({ ...VOWEL, high, low, back, round, tense }) as Record<Feature, Value>;

/** The chart: a typical set of consonants and vowels in IPA. */
export const CHART: readonly [string, Record<Feature, Value>][] = [
  ['p', C({ lab: '+' })],
  ['b', C({ lab: '+' }, VOICED)],
  ['t', C(ALVEOLAR)],
  ['d', C(ALVEOLAR, VOICED)],
  ['k', C(DORSAL)],
  ['g', C(DORSAL, VOICED)],
  ['ʔ', C({ cons: '-' })],
  ['f', C({ lab: '+', cont: '+', strid: '+' })],
  ['v', C({ lab: '+', cont: '+', strid: '+' }, VOICED)],
  ['θ', C(ALVEOLAR, { cont: '+' })],
  ['ð', C(ALVEOLAR, { cont: '+' }, VOICED)],
  ['s', C(ALVEOLAR, { cont: '+', strid: '+' })],
  ['z', C(ALVEOLAR, { cont: '+', strid: '+' }, VOICED)],
  ['ʃ', C(POSTALVEOLAR, { cont: '+', strid: '+' })],
  ['ʒ', C(POSTALVEOLAR, { cont: '+', strid: '+' }, VOICED)],
  ['x', C(DORSAL, { cont: '+' })],
  ['ɣ', C(DORSAL, { cont: '+' }, VOICED)],
  ['h', C({ cons: '-', cont: '+' })],
  ['tʃ', C(POSTALVEOLAR, { delrel: '+', strid: '+' })],
  ['dʒ', C(POSTALVEOLAR, { delrel: '+', strid: '+' }, VOICED)],
  ['m', C({ lab: '+' }, NASAL)],
  ['n', C(ALVEOLAR, NASAL)],
  ['ŋ', C(DORSAL, NASAL)],
  ['l', C(LIQUID, { lat: '+' })],
  ['r', C(LIQUID)],
  ['j', C({ cons: '-', son: '+', cont: '+', voi: '+', dor: '+', high: '+', low: '-', back: '-' })],
  ['w', C({ cons: '-', son: '+', cont: '+', voi: '+', lab: '+', ...DORSAL, round: '+' })],
  ['i', V('+', '-', '-', '-', '+')],
  ['ɪ', V('+', '-', '-', '-', '-')],
  ['y', V('+', '-', '-', '+', '+')],
  ['e', V('-', '-', '-', '-', '+')],
  ['ɛ', V('-', '-', '-', '-', '-')],
  ['ø', V('-', '-', '-', '+', '+')],
  ['æ', V('-', '+', '-', '-', '-')],
  ['a', V('-', '+', '+', '-', '-')],
  ['ə', V('-', '-', '0', '-', '-')],
  ['ʌ', V('-', '-', '+', '-', '-')],
  ['u', V('+', '-', '+', '+', '+')],
  ['ʊ', V('+', '-', '+', '+', '-')],
  ['o', V('-', '-', '+', '+', '+')],
  ['ɔ', V('-', '-', '+', '+', '-')],
];

/** Other spellings read as a chart segment. */
const ALIASES: Record<string, string> = { ɡ: 'g', ɹ: 'r', ɾ: 'r', ʧ: 'tʃ', ʤ: 'dʒ', ɑ: 'a' };

export const baseInventory = (): Inventory => new Map(CHART.map(([s, f]) => [s, { ...f }]));

/**
 * Changes to the chart, one a line: a new or changed segment, an equals sign, a chart segment to start from, and
 * the features that differ, as in "ɲ = n -ant +high -back +dor".
 */
export function editInventory(text: string, inventory: Inventory = baseInventory()): Inventory {
  const out = new Map(inventory);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const m = /^(\S+)\s*=\s*(\S+)\s*(.*)$/.exec(line);
    if (!m) throw new Error('edit');
    const from = out.get(ALIASES[m[2]] ?? m[2]);
    if (!from) throw new Error('editBase');
    out.set(m[1], { ...from, ...parseBundle(m[3]) });
  }
  return out;
}

/** Combining marks and spacing modifier letters, such as ʰ and ː, which belong to the segment before them. */
const isModifier = (c: string): boolean => {
  const code = c.codePointAt(0) ?? 0;
  return (code >= 0x300 && code <= 0x36f) || (code >= 0x2b0 && code <= 0x2ff) || (code >= 0x1dc0 && code <= 0x1dff);
};

/** Splits a word into segments by the longest match with the inventory; diacritics join the segment before them. */
export function segments(word: string, inventory: Inventory): string[] {
  const chars = [...word.normalize('NFD')];
  const longest = Math.max(1, ...[...inventory.keys()].map((s) => [...s].length));
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      i++;
      continue;
    }
    if (isModifier(chars[i]) && out.length > 0) {
      out[out.length - 1] += chars[i];
      i++;
      continue;
    }
    let size = Math.min(longest, chars.length - i);
    while (size > 1 && !inventory.has(chars.slice(i, i + size).join(''))) size--;
    out.push(chars.slice(i, i + size).join(''));
    i += size;
  }
  return out.map((s) => s.normalize('NFC'));
}

/** The segment without its diacritics, as the chart lists it. */
export function baseOf(segment: string, inventory: Inventory): string {
  if (inventory.has(segment)) return segment;
  const stripped = [...segment.normalize('NFD')].filter((c) => !isModifier(c)).join('');
  return ALIASES[stripped] ?? stripped;
}

export function featuresOf(segment: string, inventory: Inventory): Record<Feature, Value> | undefined {
  return inventory.get(baseOf(segment, inventory));
}

/** A feature bundle such as [+voice -son] or +voi, -son. */
export function parseBundle(text: string): Bundle {
  const inner = text.trim().replace(/^\[|\]$/g, '');
  const bundle: Bundle = {};
  for (const part of inner.split(/[\s,]+/).filter(Boolean)) {
    const m = /^([+\-−±0])(.+)$/.exec(part);
    if (!m) throw new Error('feature');
    bundle[featureName(m[2])] = (m[1] === '−' ? '-' : m[1]) as Value;
  }
  return bundle;
}

export const matchesBundle = (features: Record<Feature, Value> | undefined, bundle: Bundle): boolean =>
  !!features && (Object.keys(bundle) as Feature[]).every((f) => features[f] === bundle[f]);

/** Every segment of the inventory with all the features of the bundle. */
export function naturalClass(bundle: Bundle, inventory: Inventory): string[] {
  if (Object.keys(bundle).length === 0) throw new Error('noFeatures');
  return [...inventory].filter(([, f]) => matchesBundle(f, bundle)).map(([s]) => s);
}

export interface ClassCheck {
  /** Features every given segment has with the same + or - value. */
  shared: Bundle;
  /** The segments of the inventory that have all the shared features. */
  members: string[];
  /** True when the shared features pick out exactly the given segments. */
  natural: boolean;
  unknown: string[];
}

export function checkClass(list: readonly string[], inventory: Inventory): ClassCheck {
  if (list.length === 0) throw new Error('empty');
  const unknown = list.filter((s) => !featuresOf(s, inventory));
  if (unknown.length > 0) return { shared: {}, members: [], natural: false, unknown };
  const rows = list.map((s) => featuresOf(s, inventory) as Record<Feature, Value>);
  const shared: Bundle = {};
  for (const f of FEATURES) {
    const v = rows[0][f];
    if (v !== '0' && rows.every((r) => r[f] === v)) shared[f] = v;
  }
  const members = Object.keys(shared).length === 0 ? [...inventory.keys()] : naturalClass(shared, inventory);
  const wanted = new Set(list.map((s) => baseOf(s, inventory)));
  const natural = members.length === wanted.size && members.every((m) => wanted.has(m));
  return { shared, members, natural, unknown };
}

/** The features on which two segments differ. */
export function difference(a: string, b: string, inventory: Inventory): { feature: Feature; a: Value; b: Value }[] {
  const fa = featuresOf(a, inventory);
  const fb = featuresOf(b, inventory);
  if (!fa || !fb) throw new Error('unknownSegment');
  return FEATURES.filter((f) => fa[f] !== fb[f]).map((feature) => ({ feature, a: fa[feature], b: fb[feature] }));
}

export const bundleText = (bundle: Bundle): string =>
  `[${(Object.keys(bundle) as Feature[]).map((f) => `${bundle[f]}${f}`).join(' ')}]`;

/** The segment of the inventory with exactly these features, if there is one. */
export function segmentWith(features: Record<Feature, Value>, inventory: Inventory): string | undefined {
  for (const [s, f] of inventory) if (FEATURES.every((k) => f[k] === features[k])) return s;
  return undefined;
}
