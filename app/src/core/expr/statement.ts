// Statements: a line that is either an expression or a definition, such as "rent = 1200" or "f(x) = x^2".

import type { Definition, Statement } from './ast';
import type { Dialect } from './dialect';
import { tokenize, type Token } from './lexer';
import { parseTokens } from './parser';

/** The definition head at the start of the tokens, or null. Returns how many tokens it covers. */
export function definitionHead(
  tokens: readonly Token[],
): { name: Token; params: Token[]; equals: Token; length: number } | null {
  const isName = (t: Token | undefined): boolean => t !== undefined && (t.kind === 'name' || t.kind === 'word');
  const isEquals = (t: Token | undefined): boolean => t !== undefined && t.kind === 'op' && t.text === '=';
  const first = tokens[0];
  const second = tokens[1];
  if (!isName(first)) return null;
  if (isEquals(second)) return { name: first, params: [], equals: second, length: 2 };
  if (second?.kind !== 'lparen') return null;
  const params: Token[] = [];
  let at = 2;
  while (isName(tokens[at])) {
    params.push(tokens[at]);
    at += 1;
    if (tokens[at]?.kind !== 'sep') break;
    at += 1;
  }
  if (tokens[at]?.kind !== 'rparen' || !isEquals(tokens[at + 1])) return null;
  return { name: first, params, equals: tokens[at + 1], length: at + 2 };
}

/** Parses a line that is either an expression or a definition such as "rent = 1200" or "f(x) = x^2". */
export function parseStatement(
  source: string,
  dialect: Dialect,
  /** The dialect for the expression, given the parameters of the function being defined, if any. */
  bodyDialect: (params: readonly string[]) => Dialect = () => dialect,
): Statement {
  const tokens = tokenize(source, dialect.lex);
  const head = dialect.definitions ? definitionHead(tokens) : null;
  if (head === null) return { kind: 'expr', node: parseTokens(tokens, source, bodyDialect([])) };
  const params = head.params.map((t) => t.text);
  const body = parseTokens(tokens.slice(head.length), source, bodyDialect(params));
  const definition: Definition = {
    kind: 'define',
    name: head.name.text,
    params,
    body,
    nameStart: head.name.start,
    equalsAt: head.equals.start,
  };
  return definition;
}
