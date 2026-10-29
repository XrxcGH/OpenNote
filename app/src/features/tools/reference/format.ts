// How the reference tables write numbers and symbols, so a value never breaks across lines in the middle of its digits.

const NBSP = '\u00a0';

/** Joins digit groups, "×", powers of ten, and a number with its short unit by no-break spaces, so a line never ends inside a value. */
export function keepTogether(text: string): string {
  return text
    .replace(/(\d) (?=\d)/g, `$1${NBSP}`)
    .replace(/ × (?=10)/g, `${NBSP}×${NBSP}`)
    .replace(/(\d) (?=[A-Za-zΩ°µ][^\s]{0,3}(?:[\s.,;]|$))/g, `$1${NBSP}`);
}

const SYMBOLS: Readonly<Record<string, string>> = {
  hbar: 'ħ',
  eps0: 'ε₀',
  mu0: 'μ₀',
  kB: 'k_B',
  NA: 'N_A',
  qe: 'e',
  me: 'mₑ',
  mp: 'mₚ',
};

/** The symbol as a person writes it: "ħ" for hbar, "ε₀" for eps0. */
export function displaySymbol(symbol: string): string {
  return SYMBOLS[symbol] ?? symbol;
}
