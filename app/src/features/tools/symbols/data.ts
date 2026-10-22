// The symbol palette's table (Greek letters and math, science, and engineering symbols). Each symbol has the LaTeX
// command names that type it (`\alpha`), its name in words, and a group. Logic only, with no DOM and no React.

export type SymbolGroup =
  'greek' | 'operators' | 'relations' | 'arrows' | 'calculus' | 'sets' | 'logic' | 'science' | 'script';

export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  'greek',
  'operators',
  'relations',
  'arrows',
  'calculus',
  'sets',
  'logic',
  'science',
  'script',
];

export interface MathSymbol {
  char: string;
  /** LaTeX-style command names without the backslash; the first is the main one. */
  commands: readonly string[];
  /** The name in words, for searching and for screen readers. */
  name: string;
  group: SymbolGroup;
}

// [character, command names separated by spaces, name, group]
type Row = readonly [string, string, string, SymbolGroup];

const GREEK_LOWER: readonly (readonly [string, string, string])[] = [
  ['α', 'alpha', 'alpha'],
  ['β', 'beta', 'beta'],
  ['γ', 'gamma', 'gamma'],
  ['δ', 'delta', 'delta'],
  ['ε', 'epsilon varepsilon', 'epsilon'],
  ['ζ', 'zeta', 'zeta'],
  ['η', 'eta', 'eta'],
  ['θ', 'theta vartheta', 'theta'],
  ['ι', 'iota', 'iota'],
  ['κ', 'kappa', 'kappa'],
  ['λ', 'lambda', 'lambda'],
  ['μ', 'mu', 'mu'],
  ['ν', 'nu', 'nu'],
  ['ξ', 'xi', 'xi'],
  ['ο', 'omicron', 'omicron'],
  ['π', 'pi', 'pi'],
  ['ρ', 'rho varrho', 'rho'],
  ['σ', 'sigma', 'sigma'],
  ['τ', 'tau', 'tau'],
  ['υ', 'upsilon', 'upsilon'],
  ['φ', 'phi varphi', 'phi'],
  ['χ', 'chi', 'chi'],
  ['ψ', 'psi', 'psi'],
  ['ω', 'omega', 'omega'],
];

// Capital letters that look like Latin ones have no LaTeX command, so only these have an upper-case entry.
const GREEK_UPPER: readonly (readonly [string, string, string])[] = [
  ['Γ', 'Gamma', 'capital gamma'],
  ['Δ', 'Delta', 'capital delta'],
  ['Θ', 'Theta', 'capital theta'],
  ['Λ', 'Lambda', 'capital lambda'],
  ['Ξ', 'Xi', 'capital xi'],
  ['Π', 'Pi', 'capital pi'],
  ['Σ', 'Sigma', 'capital sigma'],
  ['Υ', 'Upsilon', 'capital upsilon'],
  ['Φ', 'Phi', 'capital phi'],
  ['Ψ', 'Psi', 'capital psi'],
  ['Ω', 'Omega ohm', 'capital omega, ohm'],
];

const ROWS: readonly Row[] = [
  ['±', 'pm', 'plus or minus', 'operators'],
  ['∓', 'mp', 'minus or plus', 'operators'],
  ['×', 'times', 'times', 'operators'],
  ['÷', 'div', 'divided by', 'operators'],
  ['·', 'cdot', 'dot product, centered dot', 'operators'],
  ['∘', 'circ', 'composition', 'operators'],
  ['∗', 'ast', 'asterisk operator', 'operators'],
  ['⊕', 'oplus', 'circled plus', 'operators'],
  ['⊗', 'otimes', 'circled times, tensor product', 'operators'],
  ['√', 'sqrt', 'square root', 'operators'],
  ['∛', 'cbrt', 'cube root', 'operators'],
  ['∑', 'sum', 'summation', 'operators'],
  ['∏', 'prod', 'product', 'operators'],
  ['∐', 'coprod', 'coproduct', 'operators'],
  ['⌊', 'lfloor', 'left floor', 'operators'],
  ['⌋', 'rfloor', 'right floor', 'operators'],
  ['⌈', 'lceil', 'left ceiling', 'operators'],
  ['⌉', 'rceil', 'right ceiling', 'operators'],
  ['⟨', 'langle', 'left angle bracket', 'operators'],
  ['⟩', 'rangle', 'right angle bracket', 'operators'],
  ['‖', 'Vert norm', 'norm, double bar', 'operators'],
  ['°', 'degree deg', 'degree', 'operators'],
  ['′', 'prime', 'prime', 'operators'],
  ['″', 'dprime', 'double prime', 'operators'],
  ['‰', 'permille', 'per mille', 'operators'],
  ['≠', 'neq ne', 'not equal', 'relations'],
  ['≈', 'approx', 'approximately equal', 'relations'],
  ['≃', 'simeq', 'asymptotically equal', 'relations'],
  ['≅', 'cong', 'congruent', 'relations'],
  ['≡', 'equiv', 'identical, equivalent', 'relations'],
  ['∼', 'sim', 'similar, tilde', 'relations'],
  ['∝', 'propto', 'proportional to', 'relations'],
  ['≤', 'leq le', 'less than or equal', 'relations'],
  ['≥', 'geq ge', 'greater than or equal', 'relations'],
  ['≪', 'll', 'much less than', 'relations'],
  ['≫', 'gg', 'much greater than', 'relations'],
  ['≺', 'prec', 'precedes', 'relations'],
  ['≻', 'succ', 'succeeds', 'relations'],
  ['∣', 'mid', 'divides', 'relations'],
  ['∥', 'parallel', 'parallel', 'relations'],
  ['⊥', 'perp bot', 'perpendicular, false', 'relations'],
  ['∠', 'angle', 'angle', 'relations'],
  ['≜', 'triangleq', 'defined as', 'relations'],
  ['→', 'rightarrow to', 'right arrow', 'arrows'],
  ['←', 'leftarrow gets', 'left arrow', 'arrows'],
  ['↑', 'uparrow', 'up arrow', 'arrows'],
  ['↓', 'downarrow', 'down arrow', 'arrows'],
  ['↔', 'leftrightarrow', 'left right arrow', 'arrows'],
  ['⇒', 'Rightarrow implies', 'implies, double right arrow', 'arrows'],
  ['⇐', 'Leftarrow', 'double left arrow', 'arrows'],
  ['⇔', 'Leftrightarrow iff', 'if and only if', 'arrows'],
  ['↦', 'mapsto', 'maps to', 'arrows'],
  ['⇌', 'rightleftharpoons', 'equilibrium arrows', 'arrows'],
  ['⟶', 'longrightarrow', 'long right arrow', 'arrows'],
  ['↗', 'nearrow', 'north east arrow', 'arrows'],
  ['↘', 'searrow', 'south east arrow', 'arrows'],
  ['∞', 'infty infinity', 'infinity', 'calculus'],
  ['∂', 'partial', 'partial derivative', 'calculus'],
  ['∇', 'nabla del grad', 'nabla, gradient', 'calculus'],
  ['∫', 'int integral', 'integral', 'calculus'],
  ['∬', 'iint', 'double integral', 'calculus'],
  ['∭', 'iiint', 'triple integral', 'calculus'],
  ['∮', 'oint', 'contour integral', 'calculus'],
  ['∯', 'oiint', 'surface integral', 'calculus'],
  ['ℓ', 'ell', 'script l, liter', 'calculus'],
  ['ℏ', 'hbar', 'reduced Planck constant', 'calculus'],
  ['ℑ', 'Im', 'imaginary part', 'calculus'],
  ['ℜ', 'Re', 'real part', 'calculus'],
  ['℘', 'wp', 'Weierstrass p', 'calculus'],
  ['∈', 'in', 'element of', 'sets'],
  ['∉', 'notin', 'not an element of', 'sets'],
  ['∋', 'ni', 'contains as element', 'sets'],
  ['⊂', 'subset', 'subset', 'sets'],
  ['⊆', 'subseteq', 'subset or equal', 'sets'],
  ['⊃', 'supset', 'superset', 'sets'],
  ['⊇', 'supseteq', 'superset or equal', 'sets'],
  ['⊄', 'nsubset', 'not a subset', 'sets'],
  ['∪', 'cup union', 'union', 'sets'],
  ['∩', 'cap intersection', 'intersection', 'sets'],
  ['∖', 'setminus', 'set difference', 'sets'],
  ['∅', 'emptyset varnothing', 'empty set', 'sets'],
  ['ℕ', 'naturals', 'natural numbers', 'sets'],
  ['ℤ', 'integers', 'integers', 'sets'],
  ['ℚ', 'rationals', 'rational numbers', 'sets'],
  ['ℝ', 'reals', 'real numbers', 'sets'],
  ['ℂ', 'complexes', 'complex numbers', 'sets'],
  ['ℵ', 'aleph', 'aleph', 'sets'],
  ['∀', 'forall', 'for all', 'logic'],
  ['∃', 'exists', 'there exists', 'logic'],
  ['∄', 'nexists', 'there does not exist', 'logic'],
  ['¬', 'neg lnot', 'not', 'logic'],
  ['∧', 'wedge land', 'and', 'logic'],
  ['∨', 'vee lor', 'or', 'logic'],
  ['⊢', 'vdash', 'proves', 'logic'],
  ['⊨', 'models', 'models, entails', 'logic'],
  ['∴', 'therefore', 'therefore', 'logic'],
  ['∵', 'because', 'because', 'logic'],
  ['□', 'square qed', 'end of proof', 'logic'],
  ['⊤', 'top', 'true, top', 'logic'],
  ['µ', 'micro', 'micro prefix', 'science'],
  ['Å', 'angstrom', 'angstrom', 'science'],
  ['℃', 'celsius', 'degree Celsius', 'science'],
  ['℉', 'fahrenheit', 'degree Fahrenheit', 'science'],
  ['†', 'dagger', 'dagger', 'science'],
  ['‡', 'ddagger', 'double dagger', 'science'],
  ['⁺', 'supplus', 'superscript plus', 'script'],
  ['⁻', 'supminus', 'superscript minus', 'script'],
  ['⁰', 'sup0', 'superscript zero', 'script'],
  ['¹', 'sup1', 'superscript one', 'script'],
  ['²', 'sup2 squared', 'superscript two, squared', 'script'],
  ['³', 'sup3 cubed', 'superscript three, cubed', 'script'],
  ['⁴', 'sup4', 'superscript four', 'script'],
  ['⁵', 'sup5', 'superscript five', 'script'],
  ['⁶', 'sup6', 'superscript six', 'script'],
  ['⁷', 'sup7', 'superscript seven', 'script'],
  ['⁸', 'sup8', 'superscript eight', 'script'],
  ['⁹', 'sup9', 'superscript nine', 'script'],
  ['ⁿ', 'supn', 'superscript n', 'script'],
  ['₀', 'sub0', 'subscript zero', 'script'],
  ['₁', 'sub1', 'subscript one', 'script'],
  ['₂', 'sub2', 'subscript two', 'script'],
  ['₃', 'sub3', 'subscript three', 'script'],
  ['₄', 'sub4', 'subscript four', 'script'],
  ['₅', 'sub5', 'subscript five', 'script'],
  ['₆', 'sub6', 'subscript six', 'script'],
  ['₇', 'sub7', 'subscript seven', 'script'],
  ['₈', 'sub8', 'subscript eight', 'script'],
  ['₉', 'sub9', 'subscript nine', 'script'],
  ['₊', 'subplus', 'subscript plus', 'script'],
  ['₋', 'subminus', 'subscript minus', 'script'],
  ['½', 'half', 'one half', 'script'],
  ['⅓', 'third', 'one third', 'script'],
  ['¼', 'quarter', 'one quarter', 'script'],
  ['¾', 'threequarters', 'three quarters', 'script'],
  ['…', 'ldots dots', 'ellipsis', 'script'],
  ['⋯', 'cdots', 'centered ellipsis', 'script'],
  ['⋮', 'vdots', 'vertical ellipsis', 'script'],
  ['⋱', 'ddots', 'diagonal ellipsis', 'script'],
];

export const SYMBOLS: readonly MathSymbol[] = [
  ...GREEK_LOWER.map(([char, names, name]): MathSymbol => ({ char, commands: names.split(' '), name, group: 'greek' })),
  ...GREEK_UPPER.map(([char, names, name]): MathSymbol => ({ char, commands: names.split(' '), name, group: 'greek' })),
  ...ROWS.map(([char, names, name, group]): MathSymbol => ({ char, commands: names.split(' '), name, group })),
];

const BY_COMMAND = new Map<string, MathSymbol>();
for (const symbol of SYMBOLS)
  for (const command of symbol.commands) if (!BY_COMMAND.has(command)) BY_COMMAND.set(command, symbol);

/** The symbol a command name types, such as "alpha". Matching is case-sensitive: \Gamma is not \gamma. */
export function symbolFor(command: string): MathSymbol | undefined {
  return BY_COMMAND.get(command);
}

/**
 * Symbols whose command name begins with `prefix`, best first: the exact name, then names that match the case
 * typed, then shorter names, then alphabetical. A prefix that differs only in case still finds names (so `\g`
 * offers gamma and Gamma).
 */
export function completions(prefix: string, limit = 8): { command: string; symbol: MathSymbol }[] {
  if (prefix === '') return [];
  const lower = prefix.toLowerCase();
  const found: { command: string; symbol: MathSymbol; rank: number }[] = [];
  for (const [command, symbol] of BY_COMMAND) {
    if (!command.toLowerCase().startsWith(lower)) continue;
    const rank = command === prefix ? 0 : command.startsWith(prefix) ? 1 : 2;
    found.push({ command, symbol, rank });
  }
  found.sort((a, b) => a.rank - b.rank || a.command.length - b.command.length || a.command.localeCompare(b.command));
  return found.slice(0, limit).map(({ command, symbol }) => ({ command, symbol }));
}

/** Symbols that match the palette's search box: the character, a command name, or words of the name. */
export function searchSymbols(query: string, group?: SymbolGroup): MathSymbol[] {
  const pool = group ? SYMBOLS.filter((symbol) => symbol.group === group) : SYMBOLS;
  const words = query.replace(/\\/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...pool];
  return pool.filter((symbol) => {
    const hay = `${symbol.char} ${symbol.commands.join(' ')} ${symbol.name}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}
