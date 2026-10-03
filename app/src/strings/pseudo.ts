// The pseudo-locale (ARCHITECTURE.md section 19.4): accented letters, about 40% more length, and markers at both
// ends. A Playwright project runs the main screens with it and fails on text that overflows its box, and on
// visible text without the markers, which means it skipped t().

const ACCENTED: Record<string, string> = {
  a: 'á',
  e: 'é',
  i: 'í',
  o: 'ó',
  u: 'ú',
  c: 'ç',
  n: 'ñ',
  y: 'ý',
  A: 'Á',
  E: 'É',
  I: 'Í',
  O: 'Ó',
  U: 'Ú',
  C: 'Ç',
  N: 'Ñ',
  Y: 'Ý',
};

export const PSEUDO_START = '⟦';
export const PSEUDO_END = '⟧';

export function pseudoize(text: string): string {
  const accented = [...text].map((char) => ACCENTED[char] ?? char).join('');
  const padding = '·'.repeat(Math.ceil(text.length * 0.4));
  return `${PSEUDO_START}${accented}${padding}${PSEUDO_END}`;
}
