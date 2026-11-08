// The recalculation state of one page (ADR 0065): every table's values, its formulas as units, the dependency graph,
// spills, error origins, and cycles. An edit recalculates only the units that read the changed cells, and the units
// that read those, in an order where every unit runs after the units it reads. Tarjan's algorithm gives that order
// and finds cycles in one walk. Every edit forks the state, and a fork shares what it does not change.

import { colKey, newCtx, type Ctx, type Scope, type SheetInfo } from '../formula/compile';
import type { ErrorOrigin } from '../formula/explain';
import { releaseSpill, spillBox } from '../arrays/spill';
import { Graph, stronglyConnected, type Box, type Read } from '.';
import { Cow } from './cow';
import { cycle } from './cycles';
import { evaluate } from './evaluate';
import { writeResults } from './results';
import {
  cellKey,
  compileSafely,
  inputOf,
  PLANNED,
  parseCached,
  parseName,
  refused,
  arrayFits,
  sameShapeArray,
  sameValue,
  sheetInfo,
  type CellRef,
  type CycleCell,
  type EngineEnv,
  type Unit,
} from './units';
import type { Table } from '../model';
import { tableFacts } from './facts';
import { isError, type Scalar } from '../values';

const LATE_ROUNDS = 8;
const DONE = 2;
let EPOCH = 0;

/** The recalculation state of one page: every table's values, formulas, graph, spills, and error origins. */
export class Engine {
  tables: Table[] = [];
  readonly env: EngineEnv;
  infos: SheetInfo[] = [];
  sheets: Scalar[][][] = [];
  ownCols = new Set<number>();
  units = new Cow<number, Unit>();
  cellUnit = new Cow<number, number>();
  colUnit = new Cow<number, number>();
  graph = new Graph();
  spills = new Cow<number, Box>();
  spilledBy = new Cow<number, number>();
  attempted = new Cow<number, Box>();
  dynamicReads = new Cow<number, Box[]>();
  origins = new Cow<number, ErrorOrigin>();
  cycles = new Cow<number, true>();
  volatile = new Cow<number, true>();
  pending = new Cow<number, true>();
  nextId = 0;
  changed = new Set<number>();
  late = new Set<number>();
  /** Per unit in the current round: planned to run, or already run. */
  mark = new Uint8Array(0);
  /** Set for each recalculation: a table on the page is in manual calculation. */
  anyManual = false;
  force = false;
  ctx: Ctx;

  private constructor(env: EngineEnv) {
    this.env = env;
    this.ctx = this.makeCtx();
  }

  makeCtx(): Ctx {
    const ctx = newCtx([], { spillBox: (s, c, r) => spillBox(this, s, c, r), ...tableFacts(() => this.tables) });
    return Object.assign(ctx, { sheets: this.sheets });
  }

  /** Builds the state of a page and calculates every formula. */
  static build(tables: readonly Table[], env: EngineEnv): Engine {
    const engine = new Engine(env);
    engine.tables = [...tables];
    engine.infos = tables.map(sheetInfo);
    engine.sheets = tables.map((table, s) =>
      table.columns.map((_, c) =>
        table.rows.map((row, r) => {
          const cell = row.cells[c];
          // A value left by a spill is worked out again; until then the cell is empty.
          if (cell.spill && cell.value !== null) engine.changed.add(cellKey(s, c, r));
          return inputOf(cell);
        }),
      ),
    );
    engine.ctx.sheets = engine.sheets;
    tables.forEach((table, s) => table.columns.forEach((_, c) => engine.ownCols.add(colKey(s, c))));
    tables.forEach((table, s) => {
      table.columns.forEach((column, col) => {
        if (column.formula !== undefined) engine.addUnit(s, col, null, column.formula);
      });
      table.rows.forEach((row, r) => {
        row.cells.forEach((cell, col) => {
          if (cell.formula !== undefined && table.columns[col].formula === undefined) {
            engine.addUnit(s, col, r, cell.formula, cell.array);
          }
        });
      });
    });
    engine.force = true;
    engine.run(engine.units.keys());
    engine.force = false;
    return engine;
  }

  /** A copy to change for the next edit. This state stays as it was. */
  fork(): Engine {
    const next = new Engine(this.env);
    next.tables = [...this.tables];
    next.infos = this.infos;
    next.sheets = this.sheets.map((cols) => cols.slice());
    next.ctx.sheets = next.sheets;
    this.ownCols.clear();
    next.units = this.units.fork();
    next.cellUnit = this.cellUnit.fork();
    next.colUnit = this.colUnit.fork();
    next.graph = this.graph.fork();
    next.spills = this.spills.fork();
    next.spilledBy = this.spilledBy.fork();
    next.attempted = this.attempted.fork();
    next.dynamicReads = this.dynamicReads.fork();
    next.origins = this.origins.fork();
    next.cycles = this.cycles.fork();
    next.volatile = this.volatile.fork();
    next.pending = this.pending.fork();
    next.nextId = this.nextId;
    return next;
  }

  /** True when `tables` have the same columns and rows as the state's, so an edit of cells can be applied. */
  sameShape(tables: readonly Table[]): boolean {
    return (
      tables.length === this.tables.length &&
      tables.every((t, s) => {
        const old = this.tables[s];
        return (
          t.columns === old.columns &&
          t.rows.length === old.rows.length &&
          t.names === old.names &&
          t.name === old.name &&
          t.sheetVersion === old.sheetVersion &&
          t.calc === old.calc &&
          t.iterate === old.iterate
        );
      })
    );
  }

  // Units.

  addUnit(s: number, col: number, row: number | null, formula: string, array?: Unit['array']): number {
    const table = this.tables[s];
    const result = parseCached(formula, table.sheetVersion === undefined);
    const scope: Scope = {
      columns: table.columns,
      rowCount: table.rows.length,
      env: this.env,
      sheet: s,
      book: this.infos,
      ...(this.env.functions ? { functions: this.env.functions } : {}),
      parse: parseName,
    };
    // A legacy array block must be whole rows and columns that fit in the table from its corner; else #REF!.
    const badArray = array !== undefined && row !== null && !arrayFits(array, row, col, table);
    const compiled = badArray
      ? refused('#REF!')
      : result.ok
        ? compileSafely(result.node, scope, { col, row }, formula)
        : refused(formula);
    const id = this.nextId++;
    const unit: Unit = { id, s, col, row, formula, compiled, ...(array && !badArray ? { array } : {}) };
    this.units.set(id, unit);
    if (row === null) this.colUnit.set(colKey(s, col), id);
    else this.cellUnit.set(cellKey(s, col, row), id);
    if (compiled.volatile) this.volatile.set(id, true);
    this.graph.setReads(id, compiled.reads);
    return id;
  }

  /** Takes a unit out, and gives back the cells its spill released. */
  removeUnit(id: number): Box | undefined {
    const unit = this.units.get(id);
    if (unit === undefined) return undefined;
    const released = this.spills.get(id);
    releaseSpill(this, unit, null);
    this.units.delete(id);
    if (unit.row === null) this.colUnit.delete(colKey(unit.s, unit.col));
    else this.cellUnit.delete(cellKey(unit.s, unit.col, unit.row));
    for (const map of [this.volatile, this.cycles, this.pending] as Cow<number, true>[]) map.delete(id);
    this.attempted.delete(id);
    this.dynamicReads.delete(id);
    this.graph.removeUnit(id);
    return released;
  }

  readsOf(unit: Unit): Read[] {
    const reads: Read[] = [...unit.compiled.reads, ...(this.dynamicReads.get(unit.id) ?? [])];
    const attempt = this.attempted.get(unit.id);
    if (attempt) reads.push({ ...attempt, blocker: true });
    return reads;
  }

  isManual(unit: Unit): boolean {
    return !this.force && this.tables[unit.s].calc === 'manual';
  }

  // Values.

  write(s: number, c: number, r: number, v: Scalar): void {
    const k = colKey(s, c);
    let column = this.sheets[s][c];
    if (sameValue(column[r], v)) return;
    if (!this.ownCols.has(k)) {
      column = column.slice();
      this.sheets[s][c] = column;
      this.ownCols.add(k);
    }
    column[r] = v;
    this.changed.add(cellKey(s, c, r));
    if (this.ctx.memoCols.has(k)) {
      this.ctx.memo.clear();
      this.ctx.memoCols.clear();
    }
  }

  setOrigin(key: number, v: Scalar, origin: ErrorOrigin | null): void {
    if (isError(v)) {
      this.origins.set(key, origin !== null && origin.code === v.error ? origin : { code: v.error, kind: 'formula' });
    } else if (this.origins.size > 0 && this.origins.has(key)) this.origins.delete(key);
  }

  // Evaluation.

  /** Calls `visit` with every unit that reads what `id` writes. Units in manual tables wait for F9. */
  readersOf(id: number, visit: (reader: number) => void): void {
    const unit = this.units.get(id);
    if (unit === undefined) return;
    let pass = visit;
    if (this.anyManual) {
      pass = (reader) => {
        const other = this.units.get(reader);
        if (other !== undefined && this.isManual(other)) this.pending.set(reader, true);
        else visit(reader);
      };
    }
    if (unit.row === null) this.graph.readersIn(unit.s, unit.col, 0, Infinity, false, pass);
    else {
      this.graph.readersIn(unit.s, unit.col, unit.row, unit.row, false, pass);
      if (this.spills.size > 0) {
        const box = this.spills.get(id);
        if (box) this.graph.readers(box, false, pass);
      }
    }
  }

  /** Recalculates `roots` and every unit that reads them, directly or through others. */
  run(roots: Iterable<number>): void {
    const ctx = this.ctx;
    ctx.epoch = ++EPOCH;
    ctx.memo = new Map();
    ctx.memoCols.clear();
    this.anyManual = !this.force && this.tables.some((t) => t.calc === 'manual');
    let todo: Iterable<number> = roots;
    for (let round = 0; round < LATE_ROUNDS; round++) {
      this.late = new Set();
      const size = this.nextId;
      const { order, cycles } = stronglyConnected(todo, size, (id, visit) => this.readersOf(id, visit));
      if (order.length === 0) break;
      const mark = new Uint8Array(size);
      this.mark = mark;
      for (const entry of order) {
        if (entry >= 0) mark[entry] = PLANNED;
        else for (const id of cycles[-entry - 1]) mark[id] = PLANNED;
      }
      const pending = this.pending.size > 0;
      for (const entry of order) {
        if (entry >= 0) {
          const unit = this.units.get(entry);
          if (unit) evaluate(this, unit);
          mark[entry] = DONE;
          if (pending) this.pending.delete(entry);
        } else {
          const ids = cycles[-entry - 1];
          cycle(this, ids);
          for (const id of ids) {
            mark[id] = DONE;
            if (pending) this.pending.delete(id);
          }
        }
      }
      todo = [...this.late].filter((id) => this.units.has(id));
      ctx.memo.clear();
      ctx.memoCols.clear();
    }
    this.mark = new Uint8Array(0);
  }

  // Edits.

  /**
   * Applies edits of cells (typed values or single-cell formulas) to tables of the same shape, and recalculates what
   * reads them.
   */
  applyCells(tables: readonly Table[], edits: readonly (CellRef & { table?: number })[]): void {
    this.tables = [...tables];
    this.infos = tables.map(sheetInfo);
    const roots = new Set<number>();
    const typed = (box: Box): void => this.graph.readers(box, true, (id) => roots.add(id));
    for (const edit of edits) {
      const s = edit.table ?? 0;
      const { row, col } = edit;
      const table = tables[s];
      const cell = table.rows[row]?.cells[col];
      if (cell === undefined) continue;
      const key = cellKey(s, col, row);
      // The edited cell's value in the new table may differ from the state's, so it is always written back.
      this.changed.add(key);
      const formula = table.columns[col].formula === undefined ? cell.formula : undefined;
      const oldId = this.cellUnit.get(key);
      const old = oldId === undefined ? undefined : this.units.get(oldId);
      const same = old !== undefined && old.formula === formula && sameShapeArray(old.array, cell.array);
      if (old !== undefined && !same) {
        const released = this.removeUnit(old.id);
        if (released) typed(released);
      }
      if (formula !== undefined) {
        if (!same) roots.add(this.addUnit(s, col, row, formula, cell.array));
      } else {
        if (!this.spilledBy.has(key) || cell.raw !== '') this.write(s, col, row, inputOf(cell));
        this.origins.delete(key);
      }
      typed({ s, r1: row, c1: col, r2: row, c2: col });
    }
    for (const id of this.volatile.keys()) roots.add(id);
    const ready: number[] = [];
    for (const id of roots) {
      const unit = this.units.get(id);
      if (unit === undefined) continue;
      // In a manual table only new formulas calculate; the rest waits for F9.
      if (this.isManual(unit) && !this.isNew(unit)) this.pending.set(id, true);
      else ready.push(id);
    }
    this.run(ready);
  }

  isNew(unit: Unit): boolean {
    return unit.id >= this.firstNew;
  }

  firstNew = Number.MAX_SAFE_INTEGER;

  /** Marks where this edit's new units start, so a manual table still calculates a formula typed now. */
  beginEdit(): void {
    this.firstNew = this.nextId;
  }

  /** Calculates everything, as F9 does. */
  calculateAll(): void {
    this.force = true;
    this.run(this.units.keys());
    this.force = false;
    for (const id of [...this.pending.keys()]) this.pending.delete(id);
  }

  /** True when a manual table has formulas waiting for F9. */
  get needsCalculation(): boolean {
    return this.pending.size > 0;
  }

  // Results.

  /** The tables with every changed cell replaced. Tables and rows without changes are kept as they were. */
  results(): Table[] {
    return writeResults(this);
  }

  cycleCells(): CycleCell[] {
    return [...this.cycles.keys()].flatMap((id) => {
      const unit = this.units.get(id);
      return unit ? [{ col: unit.col, row: unit.row, table: unit.s }] : [];
    });
  }

  originAt(s: number, col: number, row: number): ErrorOrigin | undefined {
    return this.origins.get(cellKey(s, col, row));
  }

  spillAt(s: number, col: number, row: number): Box | undefined {
    const id = this.cellUnit.get(cellKey(s, col, row));
    return id === undefined ? undefined : this.spills.get(id);
  }
}
