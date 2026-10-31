// Japanese kana and Hepburn romanization. Katakana is read as hiragana first. Long vowels take a macron (ou and oo
// as ō, uu as ū, aa as ā, ee as ē, and the katakana long mark ー on the vowel before it); a small tsu doubles the next
// consonant (tch before ch); n is written n' before a vowel or y. Typing romaji gives kana by the same table.

const ROWS: [string, string][] = [
  ['あいうえお', 'a i u e o'],
  ['かきくけこ', 'ka ki ku ke ko'],
  ['がぎぐげご', 'ga gi gu ge go'],
  ['さしすせそ', 'sa shi su se so'],
  ['ざじずぜぞ', 'za ji zu ze zo'],
  ['たちつてと', 'ta chi tsu te to'],
  ['だぢづでど', 'da ji zu de do'],
  ['なにぬねの', 'na ni nu ne no'],
  ['はひふへほ', 'ha hi fu he ho'],
  ['ばびぶべぼ', 'ba bi bu be bo'],
  ['ぱぴぷぺぽ', 'pa pi pu pe po'],
  ['まみむめも', 'ma mi mu me mo'],
  ['やゆよ', 'ya yu yo'],
  ['らりるれろ', 'ra ri ru re ro'],
  ['わゐゑを', 'wa i e o'],
  ['ぁぃぅぇぉ', 'a i u e o'],
];

/** One kana to its Hepburn letters. */
export const KANA: ReadonlyMap<string, string> = new Map(
  ROWS.flatMap(([kana, roma]) => {
    const letters = roma.split(' ');
    return [...kana].map((k, i): [string, string] => [k, letters[i]]);
  }),
);

/** The kana rows for the chart, in the usual order. */
export const KANA_CHART: readonly { kana: string[]; romaji: string[] }[] = ROWS.slice(0, 15).map(([kana, roma]) => ({
  kana: [...kana],
  romaji: roma.split(' '),
}));

const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' };

/** Loanword sounds written with a small vowel (katakana ティ, ファ, ウェ, read here as hiragana), and ヴ. */
const SMALL_VOWEL: Record<string, string> = {
  てぃ: 'ti',
  でぃ: 'di',
  とぅ: 'tu',
  どぅ: 'du',
  ふぁ: 'fa',
  ふぃ: 'fi',
  ふぇ: 'fe',
  ふぉ: 'fo',
  うぃ: 'wi',
  うぇ: 'we',
  うぉ: 'wo',
  いぇ: 'ye',
  ちぇ: 'che',
  じぇ: 'je',
  しぇ: 'she',
  つぁ: 'tsa',
  つぃ: 'tsi',
  つぇ: 'tse',
  つぉ: 'tso',
  ゔぁ: 'va',
  ゔぃ: 'vi',
  ゔぇ: 've',
  ゔぉ: 'vo',
};

const toHiragana = (text: string) =>
  [...text]
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : c;
    })
    .join('');

const MACRON: Record<string, string> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

/** Kana to modified Hepburn, as in shinbun, kippu, tōkyō, kin'en, and cha. */
export function hepburn(text: string): string {
  if (text.trim() === '') throw new Error('empty');
  const chars = [...toHiragana(text)];
  const syl: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    const base = KANA.get(c);
    const loan = next ? SMALL_VOWEL[c + next] : undefined;
    if (loan) {
      syl.push(loan);
      i++;
    } else if (c === 'ゔ') syl.push('vu');
    else if (base && next && SMALL_Y[next] && base.endsWith('i') && c !== 'い') {
      const stem = base.slice(0, -1);
      // shi, chi, and ji take the vowel straight on: sha, cha, ja; the others add y: kya, nya.
      syl.push(/(sh|ch|j)$/.test(stem) ? stem + SMALL_Y[next] : `${stem}y${SMALL_Y[next]}`);
      i++;
    } else if (base) syl.push(base);
    else if (c === 'ん') syl.push('N');
    else if (c === 'っ') syl.push('Q');
    else if (c === 'ー') syl.push('-');
    else syl.push(c);
  }
  let out = '';
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i];
    const next = syl[i + 1] ?? '';
    if (s === 'N') out += /^[aiueoy]/.test(next) ? "n'" : 'n';
    else if (s === 'Q')
      out += next.startsWith('ch') ? 't' : /^[a-z]/.test(next) && !/^[aiueo]/.test(next) ? next[0] : '';
    else if (s === '-') out = out.replace(/([aiueo])$/, (v) => MACRON[v]);
    else {
      const last = out.slice(-1);
      // ou and oo become ō, uu ū, aa ā, ee ē (onēsan); ei and ii stay as written.
      if (s === 'u' && (last === 'o' || last === 'u') && /[^aiueo]?[ou]$/.test(out))
        out = out.slice(0, -1) + MACRON[last];
      else if ((s === 'o' || s === 'a' || s === 'e') && last === s) out = out.slice(0, -1) + MACRON[last];
      else out += s;
    }
  }
  return out;
}

const ROMAJI: [string, string][] = (() => {
  const pairs: [string, string][] = [];
  for (const [kana, roma] of [...KANA])
    if (!/[ぁぃぅぇぉゐゑ]/.test(kana) && !pairs.some((p) => p[0] === roma)) pairs.push([roma, kana]);
  for (const [k, r] of [...KANA]) {
    if (!r.endsWith('i') || k === 'い' || k === 'ぢ' || /[ぃゐ]/.test(k)) continue;
    const stem = r.slice(0, -1);
    for (const [small, v] of Object.entries(SMALL_Y)) {
      pairs.push([/(sh|ch|j)$/.test(stem) ? stem + v : `${stem}y${v}`, k + small]);
    }
  }
  pairs.push(['si', 'し'], ['ti', 'ち'], ['tu', 'つ'], ['hu', 'ふ'], ['zi', 'じ'], ['wo', 'を']);
  return pairs.sort((a, b) => b[0].length - a[0].length);
})();

/** Romaji typed as hiragana: n' or nn not before a vowel is ん, a doubled consonant is っ, and n before a consonant is ん. */
export function toKana(text: string): string {
  if (text.trim() === '') throw new Error('empty');
  const s = text
    .toLowerCase()
    .replace(/[āâ]/g, 'aa')
    .replace(/[ūû]/g, 'uu')
    .replace(/[ōô]/g, 'ou')
    .replace(/[ēê]/g, 'ee')
    .replace(/[īî]/g, 'ii');
  let out = '';
  let i = 0;
  while (i < s.length) {
    // n' is ん; so is nn, except before a vowel or y, where the second n starts the next kana (konnichiwa).
    if (s[i] === 'n' && (s[i + 1] === "'" || s[i + 1] === 'n')) {
      out += 'ん';
      i += s[i + 1] === 'n' && /[aiueoy]/.test(s[i + 2] ?? '') ? 1 : 2;
      continue;
    }
    if (s[i] === 'n' && (i + 1 >= s.length || !/[aiueoy]/.test(s[i + 1]))) {
      out += 'ん';
      i++;
      continue;
    }
    if (/[bcdfghjkmpqrstvwxz]/.test(s[i]) && (s[i + 1] === s[i] || (s[i] === 't' && s.startsWith('ch', i + 1)))) {
      out += 'っ';
      i++;
      continue;
    }
    const hit = ROMAJI.find(([r]) => s.startsWith(r, i));
    if (hit) {
      out += hit[1];
      i += hit[0].length;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

/** Hiragana to katakana, for loanwords. */
export const toKatakana = (text: string) =>
  [...text]
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : c;
    })
    .join('');
