// LaTeX (an equation, or handwriting read as math) as the plain line text the checker reads: fractions and roots in
// brackets, relations as <= and >=, calculus marks as ∫, d/dx, lim and Σ, and matrices as [[1, 2], [3, 4]]. Anything
// it does not know stays as it is, and the reader then says it could not read the line.

const WORDS: Readonly<Record<string, string>> = {
  cdot: '*',
  times: '×',
  div: '/',
  pi: 'pi',
  le: '<=',
  leq: '<=',
  leqslant: '<=',
  ge: '>=',
  geq: '>=',
  geqslant: '>=',
  ne: '!=',
  neq: '!=',
  lt: '<',
  gt: '>',
  pm: '±',
  int: '∫',
  sum: 'Σ',
  lim: 'lim',
  to: '→',
  rightarrow: '→',
  infty: '∞',
  partial: '∂',
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  Rightarrow: '⇒',
  implies: '⇒',
  therefore: '∴',
  approx: '≈',
  theta: 'θ',
  alpha: 'α',
  beta: 'β',
};
const PASS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'det']);
const DROP = new Set([
  'left',
  'right',
  'big',
  'Big',
  'displaystyle',
  'quad',
  'qquad',
  'limits',
  'mathrm',
  'operatorname',
]);

/** The brace group at `at`: its inside and where it ends, or one character when there is no brace. */
function group(source: string, at: number): [string, number] {
  let i = at;
  while (source[i] === ' ') i += 1;
  if (source[i] !== '{') return [source[i] ?? '', i + 1];
  let depth = 0;
  for (let j = i; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}' && --depth === 0) return [source.slice(i + 1, j), j + 1];
  }
  return [source.slice(i + 1), source.length];
}

function matrix(body: string): string {
  const rows = body
    .split(/\\\\/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map(
      (row) =>
        `[${row
          .split('&')
          .map((cell) => convert(cell.trim()))
          .join(', ')}]`,
    );
  return rows.length === 1 ? rows[0] : `[${rows.join(', ')}]`;
}

function convert(latex: string): string {
  let out = '';
  let i = 0;
  while (i < latex.length) {
    const c = latex[i];
    if (c !== '\\') {
      if (c === '{') {
        const [inner, after] = group(latex, i);
        out += `(${convert(inner)})`;
        i = after;
      } else if (c === '}' || c === '$' || c === '&') i += 1;
      else {
        out += c;
        i += 1;
      }
      continue;
    }
    const word = /^\\([A-Za-z]+|.)/.exec(latex.slice(i));
    if (!word) break;
    const name = word[1];
    i += word[0].length;
    if (name === 'begin') {
      const [env, afterEnv] = group(latex, i);
      const end = latex.indexOf(`\\end{${env}}`, afterEnv);
      const stop = end < 0 ? latex.length : end;
      out += /matrix$/.test(env) ? matrix(latex.slice(afterEnv, stop)) : convert(latex.slice(afterEnv, stop));
      i = end < 0 ? latex.length : end + `\\end{${env}}`.length;
    } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const [top, afterTop] = group(latex, i);
      const [bottom, afterBottom] = group(latex, afterTop);
      const t = top.replace(/\\mathrm\{d\}/g, 'd').trim();
      const b = bottom.replace(/\\mathrm\{d\}/g, 'd').trim();
      const order = /^d\s*\^\s*\{?(\d)\}?$/.exec(t);
      const by = /^d\s*([a-zA-Z])(?:\s*\^\s*\{?\d\}?)?$/.exec(b);
      if ((t === 'd' || order) && by) out += order ? `d^${order[1]}/d${by[1]}^${order[1]} ` : `d/d${by[1]} `;
      else if (/^\\partial$/.test(t) && /^\\partial\s*[a-zA-Z]$/.test(b)) out += `∂/∂${b.slice(-1)} `;
      else out += `((${convert(top)})/(${convert(bottom)}))`;
      i = afterBottom;
    } else if (name === 'sqrt') {
      if (latex[i] === '[') {
        const close = latex.indexOf(']', i);
        const index = latex.slice(i + 1, close);
        const [inner, after] = group(latex, close + 1);
        out += `((${convert(inner)})^(1/(${convert(index)})))`;
        i = after;
      } else {
        const [inner, after] = group(latex, i);
        out += `sqrt(${convert(inner)})`;
        i = after;
      }
    } else if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
      const [inner, after] = group(latex, i);
      out += name === 'text' ? ` ${inner} ` : inner;
      i = after;
    } else if (Object.hasOwn(WORDS, name)) out += ` ${WORDS[name]} `;
    else if (PASS.has(name)) out += ` ${name} `;
    else if (DROP.has(name) || /^[,;:! ]$/.test(name)) out += ' ';
    else if (name === '|') out += '|';
    else out += `\\${name}`;
  }
  return out;
}

/** LaTeX as line text. Never throws. */
export function latexToLine(latex: string): string {
  return convert(latex.slice(0, 4000)).replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}
