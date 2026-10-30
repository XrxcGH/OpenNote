// Reads lists of complex numbers such as "-2 ± 2i, -5" or "-1+1j; -1-1j; -3" for desired pole locations.

import { ControlError } from './errors';
import { cx, type Complex } from './tf';

const NUM = String.raw`(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const COMPLEX = new RegExp(String.raw`^([+-]?${NUM})?(?:([+-]|±|\+-)(${NUM})?\*?[ij])?$`, 'i');
const IMAG = new RegExp(String.raw`^([+-]?)(${NUM})?\*?[ij]$`, 'i');

/** Every number in the list; "a ± bi" gives the conjugate pair. Throws 'complexSyntax' with the bad part. */
export function readComplexList(text: string): Complex[] {
  const out: Complex[] = [];
  const parts = text
    .replace(/−/g, '-')
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (!/[ij]/i.test(part)) {
      for (const cell of part.split(/\s+/)) {
        const v = Number(cell);
        if (!Number.isFinite(v)) throw new ControlError('complexSyntax', { part: cell });
        out.push(cx(v));
      }
      continue;
    }
    const t = part.replace(/\s+/g, '');
    const im = IMAG.exec(t);
    if (im) {
      const v = (im[1] === '-' ? -1 : 1) * Number(im[2] ?? 1);
      out.push(cx(0, v));
      continue;
    }
    const m = COMPLEX.exec(t);
    if (!m || m[2] === undefined) throw new ControlError('complexSyntax', { part });
    const re = Number(m[1] ?? 0);
    const mag = Number(m[3] ?? 1);
    if (m[2] === '±' || m[2] === '+-') {
      out.push(cx(re, mag), cx(re, -mag));
    } else out.push(cx(re, m[2] === '-' ? -mag : mag));
  }
  return out;
}

/** True when every complex number has its conjugate in the list (so the polynomial is real). */
export function conjugateClosed(zs: readonly Complex[], tol = 1e-9): boolean {
  const left = [...zs];
  while (left.length) {
    const z = left.pop() as Complex;
    if (Math.abs(z.im) <= tol * Math.max(1, Math.abs(z.re))) continue;
    const i = left.findIndex(
      (w) =>
        Math.abs(w.re - z.re) <= tol * Math.max(1, Math.abs(z.re)) &&
        Math.abs(w.im + z.im) <= tol * Math.max(1, Math.abs(z.im)),
    );
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}
