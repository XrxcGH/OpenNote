// Significant figures on page lines. When the mode is on, a question such as `2.50 * 3.1 =` is answered with the
// figures the rules allow, and a definition such as `width = 12.11` passes its figures on to later lines. Lines with
// units or anything the rules do not cover keep their usual answer.
import { NO_DIMENSION, dropTrailingEquals, parseStatement } from '../../../core/expr';
import type { Dialect, LineResult, Node, Statement } from '../../../core/expr';
import { notesDialect } from '../calculator';
import type { NotesRegion } from '../calculator';
import { ruleText } from './explain';
import { finish, trackNode } from './sigfigs';
import type { Tracked } from './sigfigs';

export interface SigAnswer {
  text: string;
  /** The rule that rounded it, in words. */
  rule: string;
}

const dimensionless = (value: { dim: readonly number[] }): boolean => value.dim.every((n, i) => n === NO_DIMENSION[i]);

/** The expression a statement computes: the line itself, or the right side of `name = …`. Null for a function. */
function bodyOf(statement: Statement): Node | null {
  if (statement.kind === 'expr') return statement.node;
  return statement.params.length === 0 ? statement.body : null;
}

function parseOrNull(source: string, dialect: Dialect): Statement | null {
  try {
    return parseStatement(source, dialect);
  } catch {
    return null;
  }
}

/**
 * The significant-figures answer for each question line (and each definition that shows its answer), by line index.
 * Lines before `from` belong to other boxes of the page: they lend their definitions and get no answers here.
 */
export function sigFigAnswers(
  lines: readonly string[],
  results: readonly LineResult[],
  region: NotesRegion,
  from = 0,
): Map<number, SigAnswer> {
  const dialect = notesDialect(region);
  const known = new Map<string, Tracked | null>();
  const answers = new Map<number, SigAnswer>();
  lines.forEach((line, index) => {
    const result = results[index];
    if (result === undefined || (result.kind !== 'result' && result.kind !== 'define')) return;
    const statement = parseOrNull(dropTrailingEquals(line.trim()), dialect);
    const node = statement === null || !dimensionless(result.value) ? null : bodyOf(statement);
    const found = node === null ? null : trackNode(node, '', (name) => known.get(name));
    if (statement?.kind === 'define') known.set(statement.name, found === null ? null : found.tracked);
    if (found === null || index < from || (result.kind === 'define' && !result.shown)) return;
    const done = finish(found.tracked, found.rule, found.limit);
    if (done.ok) answers.set(index, { text: done.text, rule: ruleText(done) });
  });
  return answers;
}
