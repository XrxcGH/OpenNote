// Subscript and superscript digits for symbols such as f₃ and 10⁶.
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** A whole number in subscript digits. */
export const sub = (n: number): string => [...String(n)].map((c) => SUB[Number(c)] ?? c).join('');

/** A whole number in superscript digits, with a superscript minus. */
export const sup = (n: number): string => [...String(n)].map((c) => (c === '-' ? '⁻' : (SUP[Number(c)] ?? c))).join('');
