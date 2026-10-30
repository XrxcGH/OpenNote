// Plain-text views of the memory tracer's snapshots: a row for every variable and heap block, a one-line summary of the
// state, and the trace table. The drawing shows the same facts as arrows; these are what a screen reader, a search and
// a pasted table use.
import type { BlockView, RunResult, Snapshot } from './memRun';

export interface VarRow {
  /** The frame's function, or an empty string for a global or a heap block. */
  scope: string;
  name: string;
  type: string;
  addr: string;
  value: string;
  region: 'stack' | 'global' | 'heap';
}

/** Names for pointer targets: a variable's name, or the heap block's number. */
function names(snap: Snapshot): Map<number, BlockView> {
  const all = [...snap.globals, ...snap.frames.flatMap((f) => f.vars), ...snap.heap];
  return new Map(all.filter((b) => b.id >= 0).map((b) => [b.id, b]));
}

function pointee(block: BlockView | undefined, index: number): string {
  if (!block) return '?';
  const name = block.name || `#${block.id}`;
  return block.cells.length > 1 ? `${name}[${index}]` : name;
}

function valueOf(block: BlockView, byId: Map<number, BlockView>, nullWord: string): string {
  if (block.refTo) return `&${pointee(byId.get(block.refTo.block), block.refTo.index)}`;
  const one = (cell: BlockView['cells'][number]): string => {
    if (cell.uninit) return '?';
    if (cell.points === 'null') return nullWord;
    if (cell.points === 'dangling') return `${cell.text} (dangling)`;
    if (cell.points) return `→ ${pointee(byId.get(cell.points.block), cell.points.index)}`;
    return cell.text;
  };
  if (block.cells.length === 1 && !block.isArray) return one(block.cells[0]!);
  return `{${block.cells.map(one).join(', ')}}`;
}

/** Every global, variable of every frame, and heap block in a snapshot, as rows. */
export function variableRows(snap: Snapshot, nullWord = 'null'): VarRow[] {
  const byId = names(snap);
  const row = (b: BlockView, scope: string, region: VarRow['region']): VarRow => ({
    scope,
    name: b.name || `#${b.id}`,
    type: b.type + (b.freed ? ' (freed)' : ''),
    addr: b.addr,
    value: valueOf(b, byId, nullWord),
    region,
  });
  return [
    ...snap.globals.map((b) => row(b, '', 'global')),
    ...snap.frames.flatMap((f) => f.vars.map((b) => row(b, f.fn, 'stack'))),
    ...snap.heap.map((b) => row(b, '', 'heap')),
  ];
}

/** One line: the variables in the innermost frame, then the heap, such as `x = 7, p = → x, #4 = 4`. */
export function summaryText(snap: Snapshot, nullWord = 'null'): string {
  const rows = variableRows(snap, nullWord);
  const inner = snap.frames.at(-1)?.fn ?? '';
  return rows
    .filter((r) => r.region !== 'stack' || r.scope === inner)
    .map((r) => `${r.name} = ${r.value}`)
    .join(', ');
}

/** The trace as a table: step, line, the source line, and the state after it. */
export function traceRows(result: RunResult, source: string, nullWord = 'null'): string[][] {
  const lines = source.split(/\r?\n/);
  return result.snapshots.map((snap) => [
    String(snap.step + 1),
    String(snap.line),
    (lines[snap.line - 1] ?? '').trim(),
    summaryText(snap, nullWord),
  ]);
}
