// Formulas written before tables followed Excel's rules (ADR 0058) keep their old meaning. A table without
// data.sheet.v was written with the textbook rules, where -2^2 is -4, 2^3^2 is 2^9, and E is the constant e. Before
// such a formula is read with the spreadsheet rules, this rewrite adds the brackets and the call that keep its
// meaning: -x^y becomes -(x^y), a^b^c becomes a^(b^c), and E becomes EXP(1). Nothing else in the text changes, so the
// rewritten text is also what a person sees once the stored text is updated.

import { parse, sheetDialect, walk, type Node } from '../../../../core/expr';
import type { Syntax } from './lexer';

interface Edit {
  /** Where the edit goes in the original text. */
  at: number;
  /** How many characters it replaces. */
  length: number;
  text: string;
  /** Edits at one place apply in this order, last first in the text: a replacement, then "(", then ")". */
  order: number;
}

/** Whether brackets were written around the whole node, which the parser records as a wider span. */
function grouped(node: Node): boolean {
  if (node.type === 'binary') return node.start !== node.left.start;
  if (node.type === 'unary') return node.start !== node.pos;
  return false;
}

function isPower(node: Node): boolean {
  return node.type === 'binary' && node.op === '^' && !grouped(node);
}

function wrap(node: Node, edits: Edit[]): void {
  edits.push({ at: node.start, length: 0, text: '(', order: 1 });
  edits.push({ at: node.end, length: 0, text: ')', order: 2 });
}

/**
 * The text of a formula from a table without data.sheet.v, rewritten to mean under the spreadsheet rules what it meant
 * under the textbook rules. Throws the ExprError of text the old rules refused, so such a table still refuses it.
 */
export function rewriteLegacy(text: string, syntax: Syntax): string {
  const tree: Node = parse(
    text,
    sheetDialect({ decimal: syntax.decimal, separator: syntax.separator, rules: 'textbook' }),
  );
  const edits: Edit[] = [];
  walk(tree, (node) => {
    if (node.type === 'unary' && isPower(node.arg)) wrap(node.arg, edits);
    if (node.type === 'binary' && node.op === '^' && isPower(node.right)) wrap(node.right, edits);
    if (node.type === 'num' && /^e$/i.test(text.slice(node.start, node.end))) {
      edits.push({ at: node.start, length: node.end - node.start, text: 'EXP(1)', order: 0 });
    }
  });
  if (edits.length === 0) return text;
  edits.sort((a, b) => b.at - a.at || a.order - b.order);
  let out = text;
  for (const edit of edits) out = out.slice(0, edit.at) + edit.text + out.slice(edit.at + edit.length);
  return out;
}
