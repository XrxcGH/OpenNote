// Numbers for LaTeX lines in worked steps: five significant digits, with powers of ten written as TeX.
import { fmt } from './types';

export function tex(x: number, digits = 5): string {
  const text = fmt(x, digits);
  const match = /^(-?[\d.]+)e([+-]?\d+)$/i.exec(text);
  if (!match) return text;
  return `${match[1]} \times 10^{${Number(match[2])}}`;
}
