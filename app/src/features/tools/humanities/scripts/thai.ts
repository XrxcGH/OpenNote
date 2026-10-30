// The tone of a Thai syllable comes from 4 things. The first is the class of its first consonant: high, mid, or
// low. The second is whether the syllable is live (a long vowel, or a final m, n, ng, y, or w) or dead (a short
// open vowel, or a final stop). The third is the vowel's length in a dead syllable with a low consonant, and the
// last is the tone mark. A silent ห before a low sonorant makes it high, and อ before ย makes it mid.

const MID = 'กจฎฏดตบปอ';
const HIGH = 'ขฃฉฐถผฝศษสห';
const SONORANT_LOW = 'งญนมยรลวฬณ';
const STOP_FINALS = 'กขคฆจฉชซฎฏฐฑฒดตถทธศษสบปพฟภ';
const LEADING = 'เแโใไ';
const SHORT = 'ะัิึุ็';
const MARKS: Record<string, Mark> = { '่': 'ek', '้': 'tho', '๊': 'tri', '๋': 'chattawa' };

export type ConsonantClass = 'high' | 'mid' | 'low';
export type Mark = 'none' | 'ek' | 'tho' | 'tri' | 'chattawa';
export type Tone = 'mid' | 'low' | 'falling' | 'high' | 'rising';

const isConsonant = (c: string) => c >= 'ก' && c <= 'ฮ';

export function consonantClass(c: string): ConsonantClass {
  if (!isConsonant(c)) throw new Error('notThai');
  if (MID.includes(c)) return 'mid';
  if (HIGH.includes(c)) return 'high';
  return 'low';
}

export interface ThaiTone {
  initial: string;
  cls: ConsonantClass;
  /** Why the class is not the consonant's own, when a silent ห or อ leads. */
  led: 'ho' | 'o' | null;
  live: boolean;
  long: boolean;
  mark: Mark;
  tone: Tone;
}

/** The rule that gives the tone, as a table: class, then live or dead, then the mark. */
export function toneOf(cls: ConsonantClass, live: boolean, long: boolean, mark: Mark): Tone {
  if (mark === 'ek') return cls === 'low' ? 'falling' : 'low';
  if (mark === 'tho') return cls === 'low' ? 'high' : 'falling';
  if (mark === 'tri') return 'high';
  if (mark === 'chattawa') return 'rising';
  if (live) return cls === 'high' ? 'rising' : 'mid';
  if (cls === 'low') return long ? 'falling' : 'high';
  return 'low';
}

/** Reads one written syllable, such as ข้าว, and works out its tone. */
export function thaiTone(syllable: string): ThaiTone {
  const chars = [...syllable.trim()];
  if (chars.length === 0) throw new Error('empty');
  if (!chars.some(isConsonant)) throw new Error('notThai');
  let i = 0;
  const leading = LEADING.includes(chars[0]) ? chars[i++] : '';
  let initial = chars[i];
  if (!isConsonant(initial)) throw new Error('notThai');
  let cls = consonantClass(initial);
  let led: ThaiTone['led'] = null;
  const second = chars[i + 1];
  if (initial === 'ห' && second && SONORANT_LOW.includes(second)) {
    initial = second;
    led = 'ho';
    i++;
  } else if (initial === 'อ' && second === 'ย') {
    initial = second;
    led = 'o';
    i++;
  }
  if (led) cls = led === 'ho' ? 'high' : 'mid';
  const rest = chars.slice(i + 1);
  const mark = (rest.map((c) => MARKS[c]).find(Boolean) ?? 'none') as Mark;
  const consonantsAfter = rest.filter(isConsonant);
  // A cluster such as กร or ขว keeps its first consonant's class; the r, l, or w is not a final.
  const clustered = consonantsAfter.length > 1 && 'รลว'.includes(rest[0]);
  const finals = clustered ? consonantsAfter.slice(1) : consonantsAfter;
  const final = finals.length > 0 ? finals[finals.length - 1] : '';
  const vowelSigns = rest.filter((c) => !isConsonant(c) && !MARKS[c]);
  const short = vowelSigns.some((c) => SHORT.includes(c)) || (leading !== '' && rest.includes('ะ'));
  // With no vowel written, a closed syllable has the short o that is read between its consonants, as in นก.
  const inherent = vowelSigns.length === 0 && leading === '' && consonantsAfter.length > 0;
  const alwaysLive =
    leading === 'ใ' || leading === 'ไ' || rest.includes('ำ') || (leading === 'เ' && rest.includes('า'));
  let live: boolean;
  if (final && STOP_FINALS.includes(final)) live = false;
  else if (final) live = true;
  else live = alwaysLive || (!short && !inherent);
  const long = !short && !inherent;
  return { initial, cls, led, live, long, mark, tone: toneOf(cls, live, long, mark) };
}
