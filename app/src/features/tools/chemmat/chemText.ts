// Small text helpers for species names: the LaTeX for a formula, a number with a power of ten, and "name = value" lists.

/** A species as LaTeX: digits after a symbol become subscripts and a trailing charge a superscript; a phase is dropped. */
export function latexSpecies(name: string): string {
  const bare = name.replace(/\((?:g|l|s|aq)\)$/, '').replace(/\s+/g, '');
  const m = /^(.*?)(?:\^?(\d*)([+-]))?$/.exec(bare);
  let body = bare;
  let charge = '';
  if (m && m[3] && m[1] !== '') {
    // A digit run right before the sign is a charge only on a lone atom (Cu2+) or after another digit (SO42-).
    const digits = m[2] ?? '';
    const atom = /^[A-Z][a-z]?$/.test(m[1]);
    if (atom || bare.includes('^')) {
      body = m[1];
      charge = digits === '' || digits === '1' ? m[3] : `${digits}${m[3]}`;
    } else if (digits.length > 1) {
      body = m[1] + digits.slice(0, -1);
      const last = digits.slice(-1);
      charge = last === '1' ? m[3] : `${last}${m[3]}`;
    } else {
      body = m[1] + digits;
      charge = m[3];
    }
  }
  const sub = body.replace(/(\d+)/g, (d, _g, offset: number) => (offset === 0 ? d : `_{${d}}`));
  return `\\mathrm{${sub}${charge ? `^{${charge}}` : ''}}`;
}

/** A number as LaTeX with a power of ten, to the given significant figures. */
export function latexNumber(x: number, digits = 4): string {
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 1e5 || abs < 1e-3) {
    const [m, e] = x.toExponential(digits - 1).split('e');
    return `${Number(m)}\\times10^{${Number(e)}}`;
  }
  return String(Number(x.toPrecision(digits)));
}

export function plain(x: number, digits = 5): string {
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 1e6 || abs < 1e-3) {
    const [m, e] = x.toExponential(digits - 1).split('e');
    return `${Number(m)}e${Number(e)}`;
  }
  return String(Number(x.toPrecision(digits)));
}

/** Reads lines or comma-separated pieces such as "H2 = 1.0" into a map; null when a piece is not "name = number". */
export function parseNamedValues(text: string): Map<string, number> | null {
  const out = new Map<string, number>();
  for (const piece of text.split(/[\n;]+|,(?=\s*[A-Za-z(])/)) {
    const trimmed = piece.trim();
    if (trimmed === '') continue;
    const m = /^(.+?)\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i.exec(trimmed);
    if (!m) return null;
    out.set(m[1].replace(/\s+/g, ''), Number(m[2]));
  }
  return out;
}
