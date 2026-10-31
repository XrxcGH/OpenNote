// Vietnamese typed in Telex or VNI, turned into letters with their marks. Telex doubles a vowel for the circumflex
// (aa â, ee ê, oo ô), adds w for the breve or horn (aw ă, ow ơ, uw ư), writes dd for đ, and ends a word with s, f,
// r, x, or j for the tones. VNI uses digits: 1 to 5 for the tones, 6 circumflex, 7 horn, 8 breve, 9 đ. The tone
// goes on a vowel with a mark (on ơ in ươ); otherwise on the last vowel when a consonant closes the syllable, on
// the middle one of three, and on the first of two.

export type Method = 'telex' | 'vni';

const TONE_MARK = ['', '́', '̀', '̉', '̃', '̣'];
const TELEX_TONE: Record<string, number> = { s: 1, f: 2, r: 3, x: 4, j: 5, z: 0 };
const SHAPE: Record<string, Record<string, string>> = {
  circumflex: { a: 'â', e: 'ê', o: 'ô' },
  breve: { a: 'ă' },
  horn: { o: 'ơ', u: 'ư' },
};
const VOWELS = 'aăâeêioôơuưy';
const MARKED = 'ăâêôơư';

function placeTone(word: string, tone: number): string {
  if (tone === 0) return word;
  const lower = word.toLowerCase();
  let start = 0;
  // The u of qu and the i of gi belong to the consonant.
  if (/^qu/.test(lower) || (/^gi/.test(lower) && VOWELS.includes(lower[2] ?? ''))) start = 2;
  const idx: number[] = [];
  for (let i = start; i < lower.length; i++) if (VOWELS.includes(lower[i])) idx.push(i);
  if (idx.length === 0) return word;
  const closed = idx[idx.length - 1] < lower.length - 1;
  let at: number;
  const marked = idx.filter((i) => MARKED.includes(lower[i]));
  if (marked.length > 0) at = marked[marked.length - 1];
  else if (closed) at = idx[idx.length - 1];
  else if (idx.length === 3) at = idx[1];
  else at = idx[0];
  return (word.slice(0, at + 1) + TONE_MARK[tone] + word.slice(at + 1)).normalize('NFC');
}

function shapeTelex(word: string): { word: string; tone: number } {
  let tone = 0;
  let w = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    const low = c.toLowerCase();
    const prev = w.slice(-1);
    const prevLow = prev.toLowerCase();
    if (i > 0 && TELEX_TONE[low] !== undefined && [...w.toLowerCase()].some((x) => VOWELS.includes(x))) {
      tone = TELEX_TONE[low];
      continue;
    }
    if (low === prevLow && SHAPE.circumflex[low]) {
      w = w.slice(0, -1) + (prev === prevLow ? SHAPE.circumflex[low] : SHAPE.circumflex[low].toUpperCase());
      continue;
    }
    if (low === 'd' && prevLow === 'd') {
      w = w.slice(0, -1) + (prev === 'D' ? 'Đ' : 'đ');
      continue;
    }
    if (low === 'w') {
      // uow is ươ; otherwise w marks the vowel before it.
      const lw = w.toLowerCase();
      if (lw.endsWith('uo')) {
        w = `${w.slice(0, -2)}${w.slice(-2, -1) === 'U' ? 'Ư' : 'ư'}${w.slice(-1) === 'O' ? 'Ơ' : 'ơ'}`;
        continue;
      }
      const shaped = SHAPE.breve[prevLow] ?? SHAPE.horn[prevLow];
      if (shaped) {
        w = w.slice(0, -1) + (prev === prevLow ? shaped : shaped.toUpperCase());
        continue;
      }
      if (i === 0 || !VOWELS.includes(prevLow)) {
        w += c === 'W' ? 'Ư' : 'ư';
        continue;
      }
    }
    w += c;
  }
  return { word: w, tone };
}

function shapeVni(word: string): { word: string; tone: number } {
  let tone = 0;
  let w = '';
  for (const c of word) {
    if (/[1-5]/.test(c)) {
      tone = Number(c);
      continue;
    }
    if (c === '0') {
      tone = 0;
      continue;
    }
    const kind = { '6': 'circumflex', '7': 'horn', '8': 'breve' }[c];
    if (kind) {
      // The mark goes on the nearest vowel that takes it; 7 after uo marks both, as ươ.
      if (kind === 'horn' && /uo$/i.test(w)) {
        w = `${w.slice(0, -2)}${w.slice(-2, -1) === 'U' ? 'Ư' : 'ư'}${w.slice(-1) === 'O' ? 'Ơ' : 'ơ'}`;
        continue;
      }
      for (let i = w.length - 1; i >= 0; i--) {
        const shaped = SHAPE[kind][w[i].toLowerCase()];
        if (shaped) {
          w = w.slice(0, i) + (w[i] === w[i].toLowerCase() ? shaped : shaped.toUpperCase()) + w.slice(i + 1);
          break;
        }
      }
      continue;
    }
    if (c === '9') {
      const i = w.toLowerCase().lastIndexOf('d');
      if (i >= 0) w = w.slice(0, i) + (w[i] === 'D' ? 'Đ' : 'đ') + w.slice(i + 1);
      continue;
    }
    w += c;
  }
  return { word: w, tone };
}

/** Converts typed Telex or VNI to Vietnamese letters, word by word. */
export function vietnamese(text: string, method: Method): string {
  if (text.trim() === '') throw new Error('empty');
  return text.replace(/[A-Za-z0-9]+/g, (raw) => {
    const { word, tone } = method === 'telex' ? shapeTelex(raw) : shapeVni(raw);
    return placeTone(word, tone);
  });
}
