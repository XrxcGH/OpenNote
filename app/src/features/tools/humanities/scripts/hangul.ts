// Hangul: syllables built from jamo by the Unicode algorithm, syllable = 0xAC00 + (L × 21 + V) × 28 + T, and the
// two common romanizations. Revised Romanization (South Korea, 2000) and McCune–Reischauer both write the sounds,
// so the sound changes at syllable joins come first. A final moves to an empty onset. Stops become nasals before
// nasals. n and l meet as ll, and l after another consonant reads n. h aspirates a neighboring stop, and t or th
// before i becomes j or ch. Two choices are the writer's, as the standard leaves them to the word: in compounds an n
// is inserted before i, ya, yeo, yo, and yu (hak-yeoul reads hangnyeoul), and in nouns h after k, t, or p is kept.

export const LEADS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export const VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
/** The 27 finals, after the empty final at index 0. */
export const TAILS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

const BASE = 0xac00;

export interface Jamo {
  l: number;
  v: number;
  t: number;
}

export function compose({ l, v, t }: Jamo): string {
  if (l < 0 || l > 18 || v < 0 || v > 20 || t < 0 || t > 27) throw new Error('jamo');
  return String.fromCodePoint(BASE + (l * 21 + v) * 28 + t);
}

export function decompose(syllable: string): Jamo {
  const code = syllable.codePointAt(0) ?? 0;
  const s = code - BASE;
  if (s < 0 || s >= 11172) throw new Error('notHangul');
  return { l: Math.floor(s / 588), v: Math.floor((s % 588) / 28), t: s % 28 };
}

/** Builds syllables from typed jamo (compatibility letters such as ㅎ ㅏ ㄴ), consonant, vowel, and final. */
export function composeJamo(text: string): string {
  const letters = [...text.replace(/\s+/g, '')];
  if (letters.length === 0) throw new Error('empty');
  let out = '';
  let i = 0;
  while (i < letters.length) {
    const l = LEADS.indexOf(letters[i]);
    const v = letters[i + 1] ? VOWELS.indexOf(letters[i + 1]) : -1;
    if (l < 0 || v < 0) throw new Error('jamoOrder');
    i += 2;
    let t = 0;
    const tail = letters[i] ? TAILS.indexOf(letters[i]) : -1;
    const isVowel = (k: number) => Boolean(letters[k] && VOWELS.includes(letters[k]));
    // A final is taken unless the letter after it is a vowel, which makes it the next onset. Two consonants that
    // make a double final (ㄹ and ㄱ make ㄺ) are joined unless a vowel follows the second.
    const pair = letters[i + 1] ? JOIN[letters[i] + letters[i + 1]] : undefined;
    if (tail > 0 && pair && !isVowel(i + 2)) {
      t = TAILS.indexOf(pair);
      i += 2;
    } else if (tail > 0 && !isVowel(i + 1)) {
      t = tail;
      i++;
    }
    out += compose({ l, v, t });
  }
  return out;
}

type Lead = string;
interface Unit {
  lead: Lead;
  vowel: string;
  tail: string;
}

const units = (word: string): Unit[] =>
  [...word].map((ch) => {
    const { l, v, t } = decompose(ch);
    return { lead: LEADS[l], vowel: VOWELS[v], tail: TAILS[t] };
  });

/** A double final split into the part that stays and the part that moves to an empty onset. */
const SPLIT: Record<string, [string, string]> = {
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
};
/** What a final sounds like at the end of a syllable. */
const NEUTRAL: Record<string, string> = {
  ㄱ: 'ㄱ',
  ㄲ: 'ㄱ',
  ㅋ: 'ㄱ',
  ㄳ: 'ㄱ',
  ㄺ: 'ㄱ',
  ㄴ: 'ㄴ',
  ㄵ: 'ㄴ',
  ㄶ: 'ㄴ',
  ㄷ: 'ㄷ',
  ㅅ: 'ㄷ',
  ㅆ: 'ㄷ',
  ㅈ: 'ㄷ',
  ㅊ: 'ㄷ',
  ㅌ: 'ㄷ',
  ㅎ: 'ㄷ',
  ㄹ: 'ㄹ',
  ㄼ: 'ㄹ',
  ㄽ: 'ㄹ',
  ㄾ: 'ㄹ',
  ㅀ: 'ㄹ',
  ㅁ: 'ㅁ',
  ㄻ: 'ㅁ',
  ㅂ: 'ㅂ',
  ㅍ: 'ㅂ',
  ㅄ: 'ㅂ',
  ㄿ: 'ㅂ',
  ㅇ: 'ㅇ',
};
/** Two consonants and the double final they make. */
const JOIN: Record<string, string> = Object.fromEntries(
  Object.entries(SPLIT).map(([double, [first, second]]) => [first + second, double]),
);
/** Words where n and l meet as nn, not ll; this is lexical, so it is a list (Standard Pronunciation, article 20). */
const N_BEFORE_L = new Set([
  '신문로',
  '의견란',
  '생산량',
  '결단력',
  '공권력',
  '동원령',
  '상견례',
  '횡단로',
  '이원론',
  '입원료',
]);
/** The vowels that take an inserted n after a final in a compound: i, ya, yeo, yo, yu. */
const N_INSERT_VOWELS = 'ㅣㅑㅕㅛㅠ';

export interface SoundOptions {
  /** A compound or a word with a prefix: insert n before i, ya, yeo, yo, and yu after a final. */
  compound?: boolean;
  /** A noun or a place name: k, t, or p before h keeps the h (Mukho), as Revised Romanization asks. */
  noun?: boolean;
}

const NASAL_OF: Record<string, string> = { ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' };
const ASPIRATE: Record<string, string> = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅂ: 'ㅍ', ㅈ: 'ㅊ' };

export type SoundRule =
  'liaison' | 'nasal' | 'lateral' | 'lToN' | 'aspiration' | 'palatal' | 'nInsertion' | 'nounH' | 'nn';

export interface Sounded {
  units: { lead: string; vowel: string; tail: string }[];
  rules: { at: number; rule: SoundRule }[];
}

/** Applies the sound changes at each join between syllables of one word. */
export function soundChanges(word: string, options: SoundOptions = {}): Sounded {
  const u = units(word);
  const rules: Sounded['rules'] = [];
  for (let i = 0; i + 1 < u.length; i++) {
    const a = u[i];
    const b = u[i + 1];
    if (a.tail === '') continue;
    if (options.compound && b.lead === 'ㅇ' && N_INSERT_VOWELS.includes(b.vowel) && a.tail !== 'ㅎ') {
      b.lead = 'ㄴ';
      rules.push({ at: i, rule: 'nInsertion' });
    }
    // h meets a plain stop: the stop is aspirated and the h is lost.
    if ((a.tail === 'ㅎ' || a.tail === 'ㄶ' || a.tail === 'ㅀ') && ASPIRATE[b.lead]) {
      b.lead = ASPIRATE[b.lead];
      a.tail = a.tail === 'ㅎ' ? '' : SPLIT[a.tail][0];
      rules.push({ at: i, rule: 'aspiration' });
      continue;
    }
    if (b.lead === 'ㅎ' && options.noun && ASPIRATE[NEUTRAL[a.tail]] && !SPLIT[a.tail]) {
      a.tail = NEUTRAL[a.tail];
      rules.push({ at: i, rule: 'nounH' });
      continue;
    }
    if (b.lead === 'ㅎ' && ASPIRATE[NEUTRAL[a.tail]] && !SPLIT[a.tail]) {
      b.lead = ASPIRATE[NEUTRAL[a.tail]];
      a.tail = '';
      rules.push({ at: i, rule: 'aspiration' });
      continue;
    }
    if (b.lead === 'ㅇ') {
      if (a.tail === 'ㅇ') continue;
      if (a.tail === 'ㅎ') {
        a.tail = '';
        continue;
      }
      const [stay, move] = SPLIT[a.tail] ?? ['', a.tail];
      a.tail = stay;
      // t or th before i is read j or ch.
      if (b.vowel === 'ㅣ' && (move === 'ㄷ' || move === 'ㅌ')) {
        b.lead = move === 'ㄷ' ? 'ㅈ' : 'ㅊ';
        rules.push({ at: i, rule: 'palatal' });
      } else {
        b.lead = move;
        rules.push({ at: i, rule: 'liaison' });
      }
      continue;
    }
    let tail = NEUTRAL[a.tail] ?? a.tail;
    if (tail === 'ㄴ' && b.lead === 'ㄹ' && N_BEFORE_L.has(word)) {
      b.lead = 'ㄴ';
      rules.push({ at: i, rule: 'nn' });
    }
    if (b.lead === 'ㄹ' && tail !== 'ㄹ' && tail !== 'ㄴ') {
      b.lead = 'ㄴ';
      rules.push({ at: i, rule: 'lToN' });
    }
    if ((tail === 'ㄴ' && b.lead === 'ㄹ') || (tail === 'ㄹ' && b.lead === 'ㄴ')) {
      tail = 'ㄹ';
      b.lead = 'ㄹ';
      rules.push({ at: i, rule: 'lateral' });
    }
    if (NASAL_OF[tail] && (b.lead === 'ㄴ' || b.lead === 'ㅁ')) {
      tail = NASAL_OF[tail];
      rules.push({ at: i, rule: 'nasal' });
    }
    a.tail = tail;
  }
  return { units: u, rules };
}

const RR_LEAD: Record<string, string> = {
  ㄱ: 'g',
  ㄲ: 'kk',
  ㄴ: 'n',
  ㄷ: 'd',
  ㄸ: 'tt',
  ㄹ: 'r',
  ㅁ: 'm',
  ㅂ: 'b',
  ㅃ: 'pp',
  ㅅ: 's',
  ㅆ: 'ss',
  ㅇ: '',
  ㅈ: 'j',
  ㅉ: 'jj',
  ㅊ: 'ch',
  ㅋ: 'k',
  ㅌ: 't',
  ㅍ: 'p',
  ㅎ: 'h',
};
const RR_VOWEL = 'a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i'.split(' ');
const MR_VOWEL = 'a ae ya yae ŏ e yŏ ye o wa wae oe yo u wŏ we wi yu ŭ ŭi i'.split(' ');
const FINAL: Record<string, string> = { ㄱ: 'k', ㄴ: 'n', ㄷ: 't', ㄹ: 'l', ㅁ: 'm', ㅂ: 'p', ㅇ: 'ng' };
const MR_LEAD: Record<string, [string, string]> = {
  // [at the start of a word or after a voiceless sound, between voiced sounds]
  ㄱ: ['k', 'g'],
  ㄷ: ['t', 'd'],
  ㅂ: ['p', 'b'],
  ㅈ: ['ch', 'j'],
  ㄲ: ['kk', 'kk'],
  ㄸ: ['tt', 'tt'],
  ㅃ: ['pp', 'pp'],
  ㅉ: ['tch', 'tch'],
  ㅊ: ["ch'", "ch'"],
  ㅋ: ["k'", "k'"],
  ㅌ: ["t'", "t'"],
  ㅍ: ["p'", "p'"],
  ㅎ: ['h', 'h'],
  ㅅ: ['s', 's'],
  ㅆ: ['ss', 'ss'],
  ㅁ: ['m', 'm'],
  ㄴ: ['n', 'n'],
  ㄹ: ['r', 'r'],
  ㅇ: ['', ''],
};

const finalSound = (tail: string) => FINAL[NEUTRAL[tail] ?? tail] ?? '';

export type Scheme = 'rr' | 'mr';

/** Romanizes Hangul words; other characters pass through. */
export function romanizeKorean(
  text: string,
  scheme: Scheme,
  capitalize = false,
  options: SoundOptions = {},
): { text: string; rules: SoundRule[] } {
  if (text.trim() === '') throw new Error('empty');
  const used: SoundRule[] = [];
  const out = text.replace(/[가-힣]+/g, (word) => {
    const { units: u, rules } = soundChanges(word, options);
    used.push(...rules.map((r) => r.rule));
    let s = '';
    u.forEach((unit, i) => {
      const prevTail = i > 0 ? u[i - 1].tail : null;
      const v = VOWELS.indexOf(unit.vowel);
      if (scheme === 'rr') {
        const lead = unit.lead === 'ㄹ' && prevTail === 'ㄹ' ? 'l' : RR_LEAD[unit.lead];
        s += lead + RR_VOWEL[v] + finalSound(unit.tail);
      } else {
        const voiced = prevTail !== null && (prevTail === '' || 'ㄴㄹㅁㅇ'.includes(prevTail));
        let lead = MR_LEAD[unit.lead][voiced ? 1 : 0];
        if (unit.lead === 'ㄹ' && prevTail === 'ㄹ') lead = 'l';
        // n before g is written n'g, so it is not read as ng.
        if (prevTail === 'ㄴ' && lead.startsWith('g')) lead = `'${lead}`;
        s += lead + MR_VOWEL[v] + finalSound(unit.tail);
      }
    });
    return capitalize ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
  return { text: out, rules: [...new Set(used)] };
}
