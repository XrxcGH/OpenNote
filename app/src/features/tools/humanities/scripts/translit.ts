// Romanization by published public schemes: the Library of Congress ALA-LC tables (a work of the US government, in
// the public domain) for Russian, modern Greek, Hindi and Sanskrit in Devanagari, Armenian, and Georgian, and the
// BGN/PCGN system for Russian. Each table maps letters by the longest match; capitals stay capitals.

export type Scheme = 'ru-alalc' | 'ru-bgn' | 'el-alalc' | 'hi-alalc' | 'hy-alalc' | 'ka-alalc';

const pairs = (keys: string, values: string): [string, string][] => {
  const k = [...keys];
  const v = values.split(' ');
  if (k.length !== v.length) throw new Error('table');
  return k.map((c, i) => [c, v[i] === '_' ? '' : v[i]]);
};

const RU_ALALC = new Map(
  pairs(
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    'a b v g d e ë zh z i ĭ k l m n o p r s t u f kh t͡s ch sh shch ʺ y ʹ ė i͡u i͡a',
  ),
);
const RU_BGN = new Map(
  pairs(
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    'a b v g d e ë zh z i y k l m n o p r s t u f kh ts ch sh shch ” y ’ e yu ya',
  ),
);
const ARMENIAN = new Map(
  pairs(
    'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆ',
    'a b g d e z ē ě tʻ zh i l kh ts k h dz gh ch m y n sh o chʻ p j ṙ s v t r tsʻ w pʻ kʻ ō f',
  ),
);
ARMENIAN.set('ու', 'u');
ARMENIAN.set('և', 'ew');
const GEORGIAN = new Map(
  pairs(
    'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ',
    'a b g d e v z tʻ i k l m n o p zh r s t u pʻ kʻ gh q sh chʻ tsʻ dz ts ch kh j h',
  ),
);

const GREEK_LETTERS = new Map(
  pairs('αβγδεζηθικλμνξοπρσςτυφχψω', 'a v g d e z ē th i k l m n x o p r s s t y ph ch ps ō'),
);
for (const [k, v] of [
  ['γγ', 'ng'],
  ['γκ', 'nk'],
  ['γξ', 'nx'],
  ['γχ', 'nch'],
  ['αυ', 'au'],
  ['ευ', 'eu'],
  ['ηυ', 'ēu'],
  ['ου', 'ou'],
] as const) {
  GREEK_LETTERS.set(k, v);
}

/** Maps by the longest key, keeping a capital first letter. */
function mapLongest(
  text: string,
  table: ReadonlyMap<string, string>,
  before?: (prev: string, key: string) => string | null,
) {
  const longest = Math.max(...[...table.keys()].map((k) => [...k].length));
  const chars = [...text];
  let out = '';
  let i = 0;
  while (i < chars.length) {
    let done = false;
    for (let size = Math.min(longest, chars.length - i); size >= 1; size--) {
      const piece = chars.slice(i, i + size).join('');
      const key = piece.toLowerCase();
      const special = before?.(i > 0 ? chars[i - 1].toLowerCase() : '', key);
      const value = special ?? table.get(key);
      if (value === undefined) continue;
      const upper = piece !== key;
      out += upper && value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
      i += size;
      done = true;
      break;
    }
    if (!done) {
      out += chars[i];
      i++;
    }
  }
  return out;
}

/** Russian е and ё are ye and yë at the start of a word and after a vowel, й, ъ, or ь in BGN/PCGN. */
const bgnBefore = (prev: string, key: string): string | null => {
  if (key !== 'е' && key !== 'ё') return null;
  const soft = prev === '' || /[\sаеёиоуыэюяйъь]/.test(prev);
  if (!soft) return null;
  return key === 'е' ? 'ye' : 'yë';
};

/** A combining accent or breathing, U+0300 to U+036F. */
const isMark = (c: string): boolean => {
  const code = c.codePointAt(0) ?? 0;
  return code >= 0x300 && code <= 0x36f;
};

/** Modern Greek: accents are dropped, a rough breathing becomes h, and a diaeresis keeps two vowels apart. */
function greek(text: string): string {
  const words = text.normalize('NFD');
  let out = '';
  for (const word of words.split(/(\s+)/)) {
    const rough = word.includes('̔');
    const split = word.replace(/([αεηιουω])̈/giu, '$1|');
    const bare = [...split]
      .filter((c) => !isMark(c))
      .join('')
      .normalize('NFC');
    let roman = mapLongest(bare.replace(/\|/g, ''), GREEK_LETTERS);
    if (split.includes('|')) {
      // A diaeresis: map the vowels on each side separately.
      roman = bare
        .split('|')
        .map((p) => mapLongest(p, GREEK_LETTERS))
        .join('');
    }
    // A rough breathing is h before the word, or after an initial r, as in rhētōr.
    if (rough && /^[Rr]/.test(roman)) roman = `${roman[0]}h${roman.slice(1)}`;
    else if (rough && roman) {
      roman = /^[A-Z]/.test(roman) ? `H${roman.charAt(0).toLowerCase()}${roman.slice(1)}` : `h${roman}`;
    }
    out += roman;
  }
  return out;
}

const DEVA_VOWELS: Record<string, string> = {
  अ: 'a',
  आ: 'ā',
  इ: 'i',
  ई: 'ī',
  उ: 'u',
  ऊ: 'ū',
  ऋ: 'ṛ',
  ॠ: 'ṝ',
  ऌ: 'l̥',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
};
const DEVA_SIGNS: Record<string, string> = {
  'ा': 'ā',
  'ि': 'i',
  'ी': 'ī',
  'ु': 'u',
  'ू': 'ū',
  'ृ': 'ṛ',
  'ॄ': 'ṝ',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
};
const DEVA_CONS = new Map(
  pairs(
    'कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह',
    'k kh g gh ṅ c ch j jh ñ ṭ ṭh ḍ ḍh ṇ t th d dh n p ph b bh m y r l v ś ṣ s h',
  ),
);

/** Devanagari with the inherent a written, as for Sanskrit: संस्कृत is saṃskṛta. */
function devanagari(text: string): string {
  const chars = [...text.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const cons = DEVA_CONS.get(c);
    if (cons !== undefined) {
      out += cons;
      const next = chars[i + 1];
      if (next === '्') i++;
      else if (next && DEVA_SIGNS[next]) {
        out += DEVA_SIGNS[next];
        i++;
      } else out += 'a';
      continue;
    }
    if (DEVA_VOWELS[c]) out += DEVA_VOWELS[c];
    else if (c === 'ं') out += 'ṃ';
    else if (c === 'ँ') out += 'm̐';
    else if (c === 'ः') out += 'ḥ';
    else if (c === 'ऽ') out += '’';
    else if (c === '।') out += '.';
    else if (c >= '०' && c <= '९') out += String(c.charCodeAt(0) - 0x966);
    else out += c;
  }
  return out;
}

export function romanize(text: string, scheme: Scheme): string {
  if (text.trim() === '') throw new Error('empty');
  switch (scheme) {
    case 'ru-alalc':
      return mapLongest(text, RU_ALALC);
    case 'ru-bgn':
      return mapLongest(text, RU_BGN, bgnBefore);
    case 'el-alalc':
      return greek(text);
    case 'hi-alalc':
      return devanagari(text);
    case 'hy-alalc':
      return mapLongest(text, ARMENIAN);
    case 'ka-alalc':
      return mapLongest(text, GEORGIAN);
  }
}

/** ALA-LC Russian back to Cyrillic, which works because the scheme gives each letter its own spelling. */
export function cyrillicFromAlaLc(text: string): string {
  if (text.trim() === '') throw new Error('empty');
  const reverse = new Map([...RU_ALALC].filter(([, v]) => v !== '').map(([k, v]) => [v, k]));
  return mapLongest(text.normalize('NFC'), reverse);
}
