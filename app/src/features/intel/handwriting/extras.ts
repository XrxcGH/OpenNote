// What handwriting recognition leaves for the app to do (Phase 12): the symbols people write in ASCII become the
// symbols they meant, chemical formulas get their subscripts, and the words the recognizer was unsure of are marked so
// the person can pick another reading. The recognizer returns plain text and other readings for each word. It gives
// no confidence, so a word counts as unsure when it has at least two other readings that differ from it by more than
// case or punctuation.
import type { InkLine, InkRecognition, InkWord } from '../../../services/intel';

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
};
const SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

const ELEMENTS = new Set(
  (
    'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb ' +
    'Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au ' +
    'Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr'
  ).split(' '),
);

/** Molecules written with one element and a digit that are common enough to rewrite without a second element. */
const DIATOMIC = new Set(['H2', 'N2', 'O2', 'F2', 'Cl2', 'Br2', 'I2', 'O3']);

const mapDigits = (digits: string, table: Record<string, string>): string =>
  [...digits].map((one) => table[one] ?? one).join('');

/** The symbols people write with the keyboard's characters, as the symbols they mean. */
export function normalizeSymbols(text: string): string {
  return (
    text
      // Longer arrows first, so "<->" isn't read as "<-" and ">".
      .replace(/<=>/g, '⇔')
      .replace(/<->/g, '↔')
      .replace(/=>/g, '⇒')
      .replace(/->/g, '→')
      .replace(/<-/g, '←')
      .replace(/\+\/-|\+-/g, '±')
      .replace(/<=/g, '≤')
      .replace(/>=/g, '≥')
      .replace(/!=/g, '≠')
      .replace(/~=/g, '≈')
      // A number followed by "deg" or "degrees", or by a lowercase o or a star and a temperature scale.
      .replace(/(\d)\s?(?:deg(?:rees?)?)\b/gi, '$1°')
      .replace(/(\d)\s?[o*]\s?([CF])\b/g, '$1°$2')
      // A micro prefix: "5 uM" and "2 ug" after a number.
      .replace(/(\d\s?)u(m|g|l|L|s|M|F|A|V|mol|Pa)\b/g, '$1µ$2')
      // Powers: m^2, 10^-3.
      .replace(/\^([+-]?\d+)/g, (_all, power: string) => mapDigits(power, SUPERSCRIPT))
  );
}

/** Splits a token into its element groups, or null when it isn't a formula. */
function formulaGroups(token: string): string[] | null {
  const groups = token.match(/[A-Z][a-z]?\d*|\(|\)\d*/g);
  if (!groups || groups.join('') !== token) return null;
  for (const group of groups) {
    if (group.startsWith('(') || group.startsWith(')')) continue;
    if (!ELEMENTS.has(/^[A-Za-z]+/.exec(group)?.[0] ?? '')) return null;
  }
  return groups;
}

/** Gives the formulas in the text their subscripts: H2O becomes H₂O, and Ca(OH)2 becomes Ca(OH)₂. */
export function subscriptFormulas(text: string): string {
  return text.replace(/(?<![A-Za-z0-9])[A-Z][A-Za-z0-9()]*(?:\^[+-]?\d*[+-]?)?(?![A-Za-z0-9])/g, (token) => {
    const [body = token, charge = ''] = token.split('^');
    const groups = formulaGroups(body);
    if (!groups || !/\d/.test(body)) return token;
    const elementGroups = groups.filter((group) => /^[A-Z]/.test(group)).length;
    if (elementGroups < 2 && !DIATOMIC.has(body)) return token;
    const written = body.replace(/(?<=[A-Za-z)])(\d+)/g, (digits) => mapDigits(digits, SUBSCRIPT));
    return charge ? `${written}${mapDigits(charge, SUPERSCRIPT)}` : written;
  });
}

/** Both fixes, for the text of a line that was just recognized. */
export function tidyRecognizedText(text: string): string {
  // Formulas first, so a charge like SO4^2- is read as part of the formula before the powers are rewritten.
  return normalizeSymbols(subscriptFormulas(text));
}

const plain = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Whether the recognizer was unsure of the word: two or more other readings that aren't just its case or punctuation. */
export function isUnsure(word: Pick<InkWord, 'text' | 'alternates'>): boolean {
  const own = plain(word.text);
  const others = new Set(word.alternates.map(plain).filter((one) => one !== own && one !== ''));
  return others.size >= 2;
}

/** The readings to offer for an unsure word, without repeats and without the reading it already has. */
export function alternativesFor(word: Pick<InkWord, 'text' | 'alternates'>, limit = 5): string[] {
  const seen = new Set([word.text]);
  const out: string[] = [];
  for (const one of word.alternates) {
    if (seen.has(one) || one.trim() === '') continue;
    seen.add(one);
    out.push(one);
    if (out.length === limit) break;
  }
  return out;
}

export interface ReviewWord {
  /** The reading in the text now. */
  text: string;
  alternatives: string[];
  unsure: boolean;
}

export type ReviewLine = ReviewWord[];

/** The recognized lines as words to review. A line the recognizer returned without words is one word. */
export function reviewLines(recognition: InkRecognition): ReviewLine[] {
  return recognition.lines
    .filter((line: InkLine) => line.text.trim() !== '')
    .map((line) =>
      line.words.length > 0
        ? line.words.map((word) => ({ text: word.text, alternatives: alternativesFor(word), unsure: isUnsure(word) }))
        : [{ text: line.text.trim(), alternatives: [], unsure: false }],
    );
}

/** The lines as tidied text. */
export function reviewText(lines: readonly ReviewLine[]): string[] {
  return lines.map((line) => tidyRecognizedText(line.map((word) => word.text).join(' ')));
}

/** How many words in the lines are unsure. */
export function unsureCount(lines: readonly ReviewLine[]): number {
  return lines.reduce((total, line) => total + line.filter((word) => word.unsure).length, 0);
}

/** The lines with one word's reading changed. The word is no longer unsure, because the person chose it. */
export function chooseReading(
  lines: readonly ReviewLine[],
  at: { line: number; word: number },
  text: string,
): ReviewLine[] {
  return lines.map((line, lineIndex) =>
    lineIndex !== at.line
      ? line
      : line.map((word, wordIndex) => {
          if (wordIndex !== at.word) return word;
          const alternatives = [word.text, ...word.alternatives].filter((one) => one !== text);
          return { text, alternatives, unsure: false };
        }),
  );
}
