// The syntax tree every dialect shares. Every node knows where it came from: `start` and `end` span all of its text,
// and `pos` is the place errors point at (the operator for an operation, the name for a call).

export interface Span {
  /** Index of the first code unit of the node's text. */
  readonly start: number;
  /** Index after the last code unit. */
  readonly end: number;
  /** Where an error about this node points. */
  readonly pos: number;
}

/** "@" is Excel's implicit intersection: one value from a range, on the formula's own row. */
export type UnaryOp = '-' | '+' | '√' | '@';
export type PostfixOp = '!' | '%' | '°';
export type BinaryOp = '+' | '-' | '*' | '/' | '^' | 'mod' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

/** A number. `text` is its digits with a period for the decimal mark, so an exact reader can use it. */
export interface NumNode extends Span {
  readonly type: 'num';
  readonly value: number;
  readonly text: string;
}
export interface StrNode extends Span {
  readonly type: 'str';
  readonly value: string;
}
export interface BoolNode extends Span {
  readonly type: 'bool';
  readonly value: boolean;
}
/** A variable or constant. Whether it has a value is for the evaluator to say. */
export interface NameNode extends Span {
  readonly type: 'name';
  readonly name: string;
}
/** A table column, by name ("[Price]") or by id ("{c0}"). */
export interface ColNode extends Span {
  readonly type: 'col';
  readonly by: 'name' | 'id';
  readonly key: string;
}
/** Which parts of a reference were written with a dollar sign, so filling and copying keep them. */
export interface CellAbs {
  readonly col: boolean;
  readonly row: boolean;
}
/** A spreadsheet cell such as $B$3. Column and row are zero-based. `abs` is set only when a "$" was written. */
export interface CellNode extends Span {
  readonly type: 'cell';
  readonly col: number;
  readonly row: number;
  readonly abs?: CellAbs;
}
/**
 * A block of cells. A whole column such as B:B has row1 0 and row2 Infinity; a whole row such as 3:3 has col1 0 and
 * col2 Infinity. `abs` gives the "$" of the first and the second corner as written, and is set only when one was.
 */
export interface RangeNode extends Span {
  readonly type: 'range';
  readonly col1: number;
  readonly row1: number;
  readonly col2: number;
  readonly row2: number;
  readonly abs?: readonly [CellAbs, CellAbs];
}
/** An array constant such as {1,2;3,4}: `rows` rows of `cols` items in row-major order. Items are literals. */
export interface ArrayNode extends Span {
  readonly type: 'array';
  readonly rows: number;
  readonly cols: number;
  readonly items: readonly Node[];
}
/** The space operator (the cells two references share) or the comma inside brackets (both references). */
export interface RefOpNode extends Span {
  readonly type: 'refop';
  readonly op: ' ' | ',';
  readonly left: Node;
  readonly right: Node;
}
/** A reference in another table or page: Sales!B2, 'Q1 budget'!Totals[Amount]. */
export interface QualifiedNode extends Span {
  readonly type: 'qualified';
  /** The name before "!", without quotes. */
  readonly scope: string;
  /** Whether the name was written in single quotes. */
  readonly quoted: boolean;
  readonly ref: Node;
}
/** The special items of a structured reference. */
export type StructItem = '#All' | '#Data' | '#Headers' | '#Totals' | '#This Row';
/**
 * A structured reference: Table[Col], Table[[#Headers],[Col]], [@Col], [#Totals], Table[[Col1]:[Col2]]. `table` is
 * unset for the formula's own table. A plain [Col] without a table stays a column node.
 */
export interface StructNode extends Span {
  readonly type: 'struct';
  readonly table?: string;
  readonly items: readonly StructItem[];
  /** "@": the formula's own row. */
  readonly thisRow: boolean;
  readonly col1?: string;
  readonly col2?: string;
}
/** A spill reference such as A1#: the whole array that spills from a cell. */
export interface SpillNode extends Span {
  readonly type: 'spill';
  readonly ref: Node;
}
export interface UnaryNode extends Span {
  readonly type: 'unary';
  readonly op: UnaryOp;
  readonly arg: Node;
}
export interface PostfixNode extends Span {
  readonly type: 'postfix';
  readonly op: PostfixOp;
  readonly arg: Node;
}
/** An operation on two values. `implicit` marks a product written by putting two things side by side, as in 2x. */
export interface BinaryNode extends Span {
  readonly type: 'binary';
  readonly op: BinaryOp;
  readonly left: Node;
  readonly right: Node;
  readonly implicit?: boolean;
}
/** A function call. `name` is the canonical name the dialect gave the function. */
export interface CallNode extends Span {
  readonly type: 'call';
  readonly name: string;
  readonly args: readonly Node[];
}
/** One unit with a power, such as "m" or "s^-2". `name` is the unit as typed. */
export interface UnitFactor {
  readonly name: string;
  readonly power: number;
  /** Where the unit's name starts. */
  readonly pos: number;
}

/** A product of units, such as km/h or kg*m/s^2. */
export interface UnitExpr {
  readonly start: number;
  readonly end: number;
  readonly factors: readonly UnitFactor[];
}

/** A number with a unit, such as 5 km or 9.8 m/s^2. */
export interface QuantityNode extends Span {
  readonly type: 'quantity';
  readonly value: NumNode;
  readonly unit: UnitExpr;
}

/** "value in unit": the same quantity written in another unit. It binds more loosely than anything else. */
export interface ConvertNode extends Span {
  readonly type: 'convert';
  readonly value: Node;
  readonly unit: UnitExpr;
}

export type Node =
  | NumNode
  | StrNode
  | BoolNode
  | NameNode
  | ColNode
  | CellNode
  | RangeNode
  | UnaryNode
  | PostfixNode
  | BinaryNode
  | CallNode
  | QuantityNode
  | ConvertNode
  | ArrayNode
  | RefOpNode
  | QualifiedNode
  | StructNode
  | SpillNode;

/** A line that gives a name a value ("rent = 1200") or defines a function ("f(x) = x^2"). */
export interface Definition {
  readonly kind: 'define';
  readonly name: string;
  /** The parameter names, empty for a plain variable. */
  readonly params: readonly string[];
  readonly body: Node;
  readonly nameStart: number;
  /** Where the equals sign is. */
  readonly equalsAt: number;
}

/** A line that is only an expression. */
export interface Expression {
  readonly kind: 'expr';
  readonly node: Node;
}

export type Statement = Definition | Expression;

/** The nodes directly inside `node`. */
/**
 * The deepest a tree may be, counted in nodes from the root to the deepest leaf. Every walker of a tree recurses,
 * and this leaves room on the stack for all of them, in a worker or on the page.
 */
export const MAX_TREE_DEPTH = 1000;

export function children(node: Node): readonly Node[] {
  switch (node.type) {
    case 'unary':
    case 'postfix':
      return [node.arg];
    case 'binary':
    case 'refop':
      return [node.left, node.right];
    case 'call':
      return node.args;
    case 'quantity':
    case 'convert':
      return [node.value];
    case 'array':
      return node.items;
    case 'qualified':
    case 'spill':
      return [node.ref];
    default:
      return [];
  }
}

/** How deep a tree is, counted in nodes from the root to the deepest leaf. It keeps a list instead of recursing. */
export function treeDepth(node: Node): number {
  let deepest = 0;
  const pending: [Node, number][] = [[node, 1]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [current, depth] = next;
    deepest = Math.max(deepest, depth);
    for (const child of children(current)) pending.push([child, depth + 1]);
  }
  return deepest;
}

/** Calls `visit` on the node and everything inside it, outer nodes first. Stops going deeper when it returns false. */
export function walk(node: Node, visit: (node: Node) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of children(node)) walk(child, visit);
}

/** The names a tree reads, in order of first use, without functions. */
export function freeNames(node: Node): string[] {
  const found: string[] = [];
  walk(node, (n) => {
    if (n.type === 'name' && !found.includes(n.name)) found.push(n.name);
  });
  return found;
}

/** The same tree with every position set to 0, for comparing trees by meaning. */
export function stripPositions(node: Node): Node {
  const span = { start: 0, end: 0, pos: 0 };
  switch (node.type) {
    case 'unary':
    case 'postfix':
      return { ...node, ...span, arg: stripPositions(node.arg) };
    case 'binary': {
      const { implicit: _implicit, ...rest } = node;
      return { ...rest, ...span, left: stripPositions(node.left), right: stripPositions(node.right) };
    }
    case 'call':
      return { ...node, ...span, args: node.args.map(stripPositions) };
    case 'quantity':
      return { ...node, ...span, value: { ...node.value, ...span }, unit: stripUnit(node.unit) };
    case 'convert':
      return { ...node, ...span, value: stripPositions(node.value), unit: stripUnit(node.unit) };
    case 'refop':
      return { ...node, ...span, left: stripPositions(node.left), right: stripPositions(node.right) };
    case 'array':
      return { ...node, ...span, items: node.items.map(stripPositions) };
    case 'qualified':
    case 'spill':
      return { ...node, ...span, ref: stripPositions(node.ref) };
    default:
      return { ...node, ...span };
  }
}

function stripUnit(unit: UnitExpr): UnitExpr {
  return { start: 0, end: 0, factors: unit.factors.map((f) => ({ ...f, pos: 0 })) };
}

function absSignature(abs: CellAbs | undefined): string {
  return abs === undefined || (!abs.col && !abs.row) ? '' : `,${abs.col ? '$' : ''}:${abs.row ? '$' : ''}`;
}

function unitSignature(unit: UnitExpr): string {
  return unit.factors.map((f) => `${f.name}^${f.power}`).join('*');
}

/** A string that is the same for two trees exactly when they mean the same. It ignores places and how a product was written. */
function signature(node: Node): string {
  switch (node.type) {
    case 'num':
      return `n(${node.value})`;
    case 'str':
      return `s(${JSON.stringify(node.value)})`;
    case 'bool':
      return `b(${node.value})`;
    case 'name':
      return `a(${JSON.stringify(node.name)})`;
    case 'col':
      return `c(${node.by},${JSON.stringify(node.key)})`;
    case 'cell':
      return `r(${node.col},${node.row}${absSignature(node.abs)})`;
    case 'range': {
      const abs = `${absSignature(node.abs?.[0])}${absSignature(node.abs?.[1])}`;
      return `g(${node.col1},${node.row1},${node.col2},${node.row2}${abs})`;
    }
    case 'array':
      return `y(${node.rows},${node.cols},${node.items.map(signature).join(',')})`;
    case 'refop':
      return `o(${JSON.stringify(node.op)},${signature(node.left)},${signature(node.right)})`;
    case 'qualified':
      return `k(${JSON.stringify(node.scope)},${signature(node.ref)})`;
    case 'struct':
      return `t(${JSON.stringify([node.table ?? null, node.items, node.thisRow, node.col1 ?? null, node.col2 ?? null])})`;
    case 'spill':
      return `h(${signature(node.ref)})`;
    case 'unary':
      return `u(${node.op},${signature(node.arg)})`;
    case 'postfix':
      return `p(${node.op},${signature(node.arg)})`;
    case 'binary':
      return `x(${node.op},${signature(node.left)},${signature(node.right)})`;
    case 'call':
      return `f(${JSON.stringify(node.name)},${node.args.map(signature).join(',')})`;
    case 'quantity':
      return `q(${node.value.value},${unitSignature(node.unit)})`;
    case 'convert':
      return `v(${signature(node.value)},${unitSignature(node.unit)})`;
  }
}

/** True when two trees mean the same, ignoring where they came from and whether a product had a sign. */
export function sameTree(a: Node, b: Node): boolean {
  return signature(a) === signature(b);
}
