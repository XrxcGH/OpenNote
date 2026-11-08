// One workbook per page (ADR 0062, ADR 0065). Every smart table of a page calculates with the others, so a formula
// in one table can read Sales[Amount] in another. A page of up to 20,000 cells calculates at once on the page; a
// larger one goes to the worker, and its results come back as display changes that add no undo step. The cache of
// results (ADR 0061, data.sheet.values) is worked out here too, so it goes in the same patch as the edit.
import type { TableData } from '../../../editor/schema/specs';
import { ERROR_TOKENS, isError, recalculateBook, todayDays } from '../engine';
import { toScalar } from '../engine/values';
import type { EngineEnv, Table } from '../engine';
import { createRecalcClient, needsWorker, WORKER_CELLS } from '../engine/worker/client';
import type { RecalcClient, RecalcClientOptions } from '../engine/worker/client';
import { readableText, readSheet, sheetPatch, writeValues } from '../sheet/model';
import type { CachedValue, Sheet } from '../sheet/model';
import { applyPatch, isObject } from '../sheet/model/json';
import type { Json, JsonObject } from '../sheet/model/json';
import type { Grid } from './model';

/** A table of the page: where it sits, its cells before the formulas run, and where its results go. */
export interface BookMember {
  /** The table block's element, so tables are numbered Table1, Table2, ... in page order. */
  readonly element: Element;
  /** The table with its formulas still to run. Returns the same object while the cells do not change. */
  raw(): Table;
  /** The page's results for this table. `busy` is true while the worker still works (formulas show #BUSY!). */
  calculated(table: Table, busy: boolean): void;
  /** The worker starts (true) or stops (false) calculating the page. */
  working?(on: boolean): void;
}

/** How a page's tables are calculated together. */
export class PageBook {
  private readonly members = new Set<BookMember>();
  private client: RecalcClient | null = null;
  private generation = 0;
  private busy = false;
  private last: { raws: readonly Table[]; results: readonly Table[] } | null = null;
  // One environment per page: the engine compares it by identity and starts over for a new one (ADR 0065).
  private readonly env: EngineEnv = { today: () => todayDays() };

  constructor(
    private readonly options: RecalcClientOptions = {},
    private readonly gone: () => void = () => {},
  ) {}

  join(member: BookMember): void {
    this.members.add(member);
  }

  leave(member: BookMember): void {
    this.members.delete(member);
    if (this.members.size > 0) return;
    this.client?.dispose();
    this.client = null;
    this.gone();
  }

  /** The members in page order. */
  ordered(): BookMember[] {
    return [...this.members].sort((a, b) =>
      a.element === b.element ? 0 : a.element.compareDocumentPosition(b.element) & 4 ? -1 : 1,
    );
  }

  private raws(member?: BookMember, raw?: Table): { members: BookMember[]; raws: Table[] } {
    const members = this.ordered();
    return { members, raws: members.map((one) => (one === member && raw ? raw : one.raw())) };
  }

  /** True when the page is large enough for the worker. */
  usesWorker(): boolean {
    return needsWorker(this.raws().raws, this.options.threshold ?? WORKER_CELLS);
  }

  /** The results of the last calculation, when it was made from exactly these tables. */
  private known(raws: readonly Table[]): readonly Table[] | null {
    const last = this.last;
    if (!last || last.raws.length !== raws.length) return null;
    return last.raws.every((one, i) => one === raws[i]) ? last.results : null;
  }

  /**
   * The member's table calculated with the rest of the page, at once, with `raw` in place of its current cells.
   * Null when the page needs the worker and these cells have not been calculated yet.
   */
  calculateNow(member: BookMember, raw?: Table): Table | null {
    const { members, raws } = this.raws(member, raw);
    const at = members.indexOf(member);
    if (at < 0) return null;
    const known = this.known(raws);
    if (known) return known[at];
    if (needsWorker(raws, this.options.threshold ?? WORKER_CELLS)) return null;
    const results = recalculateBook(raws, this.env);
    if (!raw) this.last = { raws, results };
    return results[at];
  }

  /** Tells the members the worker started or stopped, once for each change. */
  private working(members: readonly BookMember[], on: boolean): void {
    if (this.busy === on) return;
    this.busy = on;
    members.forEach((member) => member.working?.(on));
  }

  /** Calculates the page and gives every member its results: at once on a small page, from the worker on a large one. */
  refresh(): void {
    const { members, raws } = this.raws();
    const generation = ++this.generation;
    const give = (results: readonly Table[], busy: boolean) => {
      if (generation !== this.generation) return;
      if (!busy) {
        this.last = { raws, results };
        this.working(members, false);
      }
      members.forEach((member, i) => this.members.has(member) && member.calculated(results[i], busy));
    };
    const known = this.known(raws);
    if (known) return give(known, false);
    if (!needsWorker(raws, this.options.threshold ?? WORKER_CELLS)) return give(recalculateBook(raws, this.env), false);
    this.client ??= createRecalcClient(this.options);
    // The worker's answer: the tables stop being busy at once, and draw their results in a task of their own, so
    // the task that brings the answer stays short and a frame never waits for both.
    const answer = (results: readonly Table[], busy: boolean) => {
      if (generation !== this.generation) return;
      if (!busy) this.working(members, false);
      setTimeout(() => give(results, busy), 0);
    };
    const done = this.client.recalc(raws, this.env, (late) => answer(late, false));
    // The tables went to the worker inside recalc, so from here the page's thread is free until the answer.
    this.working(members, true);
    void done.then((results) =>
      answer(
        results,
        results.some((table) => table.rows.some(isBusyRow)),
      ),
    );
  }
}

const isBusyRow = (row: Table['rows'][number]) =>
  row.cells.some((cell) => cell.formula !== undefined && isError(cell.value) && cell.value.error === 'BUSY');

const books = new Map<string, PageBook>();

/** The workbook of a page, made when its first table asks. */
export function bookFor(page: string, options?: RecalcClientOptions): PageBook {
  let book = books.get(page);
  if (!book) {
    book = new PageBook(options, () => books.delete(page));
    books.set(page, book);
  }
  return book;
}

/** The typed text of a table's cells, read from its Markdown as the editor shows it. */
export function gridOfData(data: TableData): Grid {
  const columnIds = data.columns.map((column) => column.id);
  const texts = data.rows.map((row) =>
    columnIds.map((id) => {
      const markdown = Object.hasOwn(row.cells, id) ? row.cells[id].markdown : '';
      return markdown === '' ? '' : readableText(markdown);
    }),
  );
  return { header: data.header, columnIds, texts };
}

/** A result as the cache holds it (R-SHT-17): a number, text, a truth value, empty, or an error token. */
export function cachedOf(value: Table['rows'][number]['cells'][number]['value']): CachedValue | undefined {
  const scalar = toScalar(value);
  if (scalar === null || typeof scalar === 'string' || typeof scalar === 'boolean') return scalar;
  if (typeof scalar === 'number') return Number.isFinite(scalar) ? scalar : undefined;
  // #BUSY! is not a result: the cache keeps no entry rather than a value nobody calculated.
  return scalar.error === 'BUSY' ? undefined : { e: ERROR_TOKENS[scalar.error] };
}

/** The results of a calculated table's formula and spilled cells, by row ID, then column ID. */
export function resultValues(
  table: Table,
  rowIds: readonly string[],
  columnIds: readonly string[],
): Map<string, Map<string, CachedValue>> {
  const values = new Map<string, Map<string, CachedValue>>();
  table.rows.forEach((row, r) => {
    const rowId = rowIds[r];
    if (rowId === undefined) return;
    row.cells.forEach((cell, c) => {
      if (cell.formula === undefined && cell.spill !== true) return;
      const value = cachedOf(cell.value);
      const col = columnIds[c];
      if (value === undefined || col === undefined) return;
      let byCol = values.get(rowId);
      if (!byCol) values.set(rowId, (byCol = new Map()));
      byCol.set(col, value);
    });
  });
  return values;
}

/** The block data an edit leaves: what the page holds with the edit's `extra` keys merged in. */
export function sheetAfter(stored: Record<string, unknown>, extra?: Record<string, unknown>): Sheet | null {
  const before = stored.sheet;
  const patch = extra?.sheet;
  if (patch === undefined) return isObject(before) ? readSheet(stored) : null;
  const merged = applyPatch(isObject(before) ? (before as Json) : undefined, patch as Json);
  return isObject(merged) && Object.keys(merged).length > 0 ? merged : null;
}

/**
 * The `sheet` patch that writes a table's results with the edit that changed them (R-SHT-17), or null when the cache
 * already holds them. A table without data.sheet gets none: a page Beta 8 wrote stays as it was until a formatting
 * command gives the table a sheet.
 */
export function valuesPatch(
  stored: Record<string, unknown>,
  data: TableData,
  extra: Record<string, unknown> | undefined,
  results: Table,
): JsonObject | null {
  const after = sheetAfter(stored, extra);
  if (!after) return null;
  const smart = extra?.smart === undefined ? stored.smart : applyPatch(stored.smart as Json, extra.smart as Json);
  const table = { header: data.header, columns: data.columns, rows: data.rows, smart: smart ?? undefined };
  const offset = data.header ? 1 : 0;
  const rowIds = data.rows.slice(offset).map((row) => row.id);
  const next = structuredClone(after);
  writeValues(
    next,
    table,
    resultValues(
      results,
      rowIds,
      data.columns.map((column) => column.id),
    ),
  );
  const patch = sheetPatch(readSheet(stored), next);
  if (!patch) return null;
  // Nothing to change but what `extra` already says: leave it as it is.
  if (extra?.sheet !== undefined && JSON.stringify(after) === JSON.stringify(next)) return null;
  return patch;
}
