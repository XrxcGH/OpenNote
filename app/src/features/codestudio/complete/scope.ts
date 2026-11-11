// The scope source (DESIGN 10.2): identifiers declared in the scopes around the caret, read from the Lezer tree.
// A nearer scope and a nearer line rank higher. One walk per tree is cached, so typing only filters.

import type { syntaxTree } from '@codemirror/language';

export type SyntaxTree = ReturnType<typeof syntaxTree>;

/** One name the tree binds, and the scope it lives in. */
export interface Binding {
  name: string;
  from: number;
  scopeFrom: number;
  scopeTo: number;
  /** How many scopes enclose it; 0 is the file. */
  depth: number;
  /** A definition (a function, class, or parameter name) rather than a use. */
  declared: boolean;
}

// Identifier nodes of the lang-* grammars (Python, JavaScript, C, C++, Java, Rust, and Go).
const NAMES = new Set(['VariableName', 'VariableDefinition', 'Identifier', 'Definition', 'DefName', 'BoundIdentifier']);
const PARAMETERS = new Set(['ParamList', 'ParameterList', 'FormalParameters', 'Parameter', 'Parameters']);
// Scopes that own their name: the name belongs to the outer scope.
const DEFINITIONS = new Set([
  'FunctionDefinition',
  'ClassDefinition',
  'FunctionDeclaration',
  'ClassDeclaration',
  'MethodDeclaration',
  'FunctionItem',
]);
// Python binds names per function and class; blocks do not open scopes.
const PYTHON_SCOPES = new Set(['FunctionDefinition', 'ClassDefinition', 'LambdaExpression']);
const BLOCK_SCOPES = new Set([
  ...DEFINITIONS,
  'ArrowFunction',
  'FunctionExpression',
  'Block',
  'CompoundStatement',
  'ClassBody',
]);

interface Open {
  from: number;
  to: number;
  definition: boolean;
  named: boolean;
}

const cache = new WeakMap<SyntaxTree, Binding[]>();

/** Every binding in the tree. Cached per tree, so a keystroke that does not reparse costs nothing here. */
export function bindings(tree: SyntaxTree, text: string, language: string): Binding[] {
  const known = cache.get(tree);
  if (known) return known;
  const scopes = language === 'python' ? PYTHON_SCOPES : BLOCK_SCOPES;
  const found: Binding[] = [];
  const stack: Open[] = [{ from: 0, to: Number.MAX_SAFE_INTEGER, definition: false, named: true }];
  let inParameters = 0;
  tree.iterate({
    enter(node) {
      const name = node.name;
      if (scopes.has(name)) {
        stack.push({ from: node.from, to: node.to, definition: DEFINITIONS.has(name), named: false });
        return;
      }
      if (PARAMETERS.has(name)) inParameters++;
      if (!NAMES.has(name)) return;
      const top = stack[stack.length - 1]!;
      // The first name inside a function or class definition is its own name, bound in the outer scope.
      const own = top.definition && !top.named && inParameters === 0;
      if (top.definition) top.named = true;
      const scope = own ? (stack[stack.length - 2] ?? top) : top;
      found.push({
        name: text.slice(node.from, node.to),
        from: node.from,
        scopeFrom: scope.from,
        scopeTo: scope.to,
        depth: own ? stack.length - 2 : stack.length - 1,
        declared: own || inParameters > 0 || name === 'VariableDefinition' || name === 'DefName',
      });
    },
    leave(node) {
      if (scopes.has(node.name)) stack.pop();
      else if (PARAMETERS.has(node.name)) inParameters--;
    },
  });
  cache.set(tree, found);
  return found;
}

/** A visible name with its proximity bonus. */
export interface ScopeName {
  name: string;
  proximity: number;
}

function lineOf(lineStarts: readonly number[], pos: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid]! <= pos) low = mid;
    else high = mid - 1;
  }
  return low;
}

function starts(text: string): number[] {
  const result = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) result.push(i + 1);
  return result;
}

/**
 * The names visible at `pos` (their scope contains it), except the word being typed, each with its best proximity.
 * Deeper scopes and nearer lines score higher, and declarations a little more than uses.
 */
export function namesInScope(all: readonly Binding[], text: string, pos: number, wordFrom: number): ScopeName[] {
  const lineStarts = starts(text);
  const caretLine = lineOf(lineStarts, pos);
  const best = new Map<string, number>();
  for (const binding of all) {
    if (binding.from === wordFrom || pos < binding.scopeFrom || pos > binding.scopeTo) continue;
    const distance = Math.abs(lineOf(lineStarts, binding.from) - caretLine);
    const proximity = Math.min(binding.depth, 3) * 0.5 + 1 / (1 + distance / 20) + (binding.declared ? 0.5 : 0);
    if (proximity > (best.get(binding.name) ?? -1)) best.set(binding.name, proximity);
  }
  return [...best].map(([name, proximity]) => ({ name, proximity }));
}
