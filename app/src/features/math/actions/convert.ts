// Between LaTeX and the shared expression engine's text and trees (Phase 10), for the Simplify and Solve actions. It
// reads the LaTeX people write for school math: fractions, roots, powers, products, brackets, the usual functions,
// and pi. Anything else is "unsupported", and the action says so instead of guessing.
import type { Node } from '../../../core/expr';

export class Unsupported extends Error {}

const FUNCTIONS: Record<string, string> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  ln: 'ln',
  log: 'log',
  exp: 'exp',
};
const IGNORED = new Set([',', ';', ':', '!', ' ', 'left', 'right', 'quad', 'qquad', 'displaystyle']);

/** The brace group starting at `at` (a `{...}` or one character), and where it ends. */
function group(source: string, at: number): [string, number] {
  let i = at;
  while (source[i] === ' ') i += 1;
  if (source[i] !== '{') {
    if (i >= source.length) throw new Unsupported();
    return [source[i], i + 1];
  }
  let depth = 0;
  for (let j = i; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}' && --depth === 0) return [source.slice(i + 1, j), j + 1];
  }
  throw new Unsupported();
}

/** LaTeX as the engine's text, such as `\frac{x}{2}` to `((x)/(2))`. Throws Unsupported for anything it cannot read. */
export function latexToText(latex: string): string {
  let out = '';
  let i = 0;
  while (i < latex.length) {
    const c = latex[i];
    if (c === '\\') {
      const word = /^\\([A-Za-z]+|.)/.exec(latex.slice(i));
      if (!word) throw new Unsupported();
      const name = word[1];
      i += word[0].length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [top, afterTop] = group(latex, i);
        const [bottom, afterBottom] = group(latex, afterTop);
        out += `((${latexToText(top)})/(${latexToText(bottom)}))`;
        i = afterBottom;
      } else if (name === 'sqrt') {
        if (latex[i] === '[') throw new Unsupported();
        const [inner, after] = group(latex, i);
        out += `sqrt(${latexToText(inner)})`;
        i = after;
      } else if (name === 'cdot' || name === 'times') out += '*';
      else if (name === 'div') out += '/';
      else if (name === 'pi') out += 'pi';
      else if (name in FUNCTIONS) out += FUNCTIONS[name];
      else if (!IGNORED.has(name)) throw new Unsupported();
    } else if (c === '{') {
      const [inner, after] = group(latex, i);
      out += `(${latexToText(inner)})`;
      i = after;
    } else if (c === '_' || c === '}' || c === '&' || c === '$') throw new Unsupported();
    else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const GREEK: Record<string, string> = { pi: '\\pi', tau: '\\tau', phi: '\\varphi' };
const NAMED = new Set(['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp']);
const INVERSE: Record<string, string> = { asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan' };

const wrap = (text: string) => `\\left(${text}\\right)`;
const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 3, '^': 4 };

function precedence(node: Node): number {
  if (node.type === 'binary') return PRECEDENCE[node.op] ?? 0;
  return node.type === 'unary' ? 2 : 5;
}

/** A tree as LaTeX: fractions, roots, and powers drawn as such, with only the brackets that are needed. */
export function treeToLatex(node: Node): string {
  const show = (child: Node, floor: number): string => {
    const text = treeToLatex(child);
    return precedence(child) < floor ? wrap(text) : text;
  };
  switch (node.type) {
    case 'num':
      return node.text;
    case 'name':
      return GREEK[node.name] ?? node.name;
    case 'unary':
      if (node.op === '√') return `\\sqrt{${treeToLatex(node.arg)}}`;
      return `${node.op}${show(node.arg, 3)}`;
    case 'postfix':
      return `${show(node.arg, 5)}${node.op === '%' ? '\\%' : node.op === '°' ? '^{\\circ}' : node.op}`;
    case 'binary': {
      if (node.op === '/') return `\\frac{${treeToLatex(node.left)}}{${treeToLatex(node.right)}}`;
      if (node.op === '^') return `${show(node.left, 5)}^{${treeToLatex(node.right)}}`;
      if (node.op === '*') {
        const left = show(node.left, 2);
        const right = show(node.right, 3);
        const joined = node.implicit || (node.left.type === 'num' && node.right.type === 'name');
        return joined ? `${left}${right}` : `${left} \\cdot ${right}`;
      }
      const sign = node.op === '=' || node.op === '+' || node.op === '-' ? node.op : ` ${node.op} `;
      const left = show(node.left, 1);
      const right = show(node.right, node.op === '-' ? 2 : 1);
      return node.op === '=' ? `${left} = ${right}` : `${left}${sign}${right}`;
    }
    case 'call': {
      const args = node.args.map((arg) => treeToLatex(arg)).join(', ');
      if (node.name === 'sqrt') return `\\sqrt{${args}}`;
      if (node.name === 'abs') return `\\left|${args}\\right|`;
      if (NAMED.has(node.name)) return `\\${node.name}${wrap(args)}`;
      if (node.name in INVERSE) return `${INVERSE[node.name]}${wrap(args)}`;
      return `\\operatorname{${node.name}}${wrap(args)}`;
    }
    default:
      throw new Unsupported();
  }
}
