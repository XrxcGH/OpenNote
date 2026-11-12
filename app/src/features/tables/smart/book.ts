// One workbook per page (ADR 0062, ADR 0065). Every smart table of a page calculates with the others, so a formula
// in one table can read Sales[Amount] in another. A page of up to 20,000 cells calculates at once on the page; a
// larger one goes to the worker, and its results come back as display changes that add no undo step. The cache of
// results (ADR 0061, data.sheet.values) is worked out here too, so it goes in the same patch as the edit.
import type { TableData } from '../../../editor/schema/specs';
import { ERROR_TOKENS, isError, recalculateBook, todayDays } from '../engine';
import { onFinanceLoaded } from '../engine/formula/fn/finance';
import { toScalar } from '../engine/values';
import type { EngineEnv, Table } from '../engine';
import { cellCount, createRecalcClient, needsWorker, WORKER_CELLS } from '../engine/worker/client';
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
  /**
   * The page's results for this table. `busy` is true while the worker still works (formulas show #BUSY!). `raw` is
   * the table they were calculated from, which an edit since may have changed.
   */
  calculated(table: Table, busy: boolean, raw: Table): void;
  /** The worker starts (true) or stops (false) calculating the page. */
  working?(on: boolean): void;
}

/** How a page's tables are calculated together. */
export class PageBook {
  private readonly members = new Set<BookMember>();
  private client: RecalcClient | null = null;
  private generation = 0;
  private busy = false;
  /** The cells of the job the worker runs now, and whether an edit came after it. */
  private flight: readonly Table[] | null = null;
  private queued = false;
  /** The last two calculations, newest first: the edit's own and the page's, say. */
  private last: { raws: readonly Table[]; results: readonly Table[] }[] = [];
  // One environment per page: the engine compares it by identity and starts over for a new one (ADR 0065).
  private readonly env: EngineEnv = { today: () => todayDays() };
  // The financial functions load on first use and show #BUSY! until then; once they land the page calculates again.
  private readonly stopLoaded = onFinanceLoaded(() => this.reload());

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
    this.flight = null;
    this.queued = false;
    this.stopLoaded();
    this.gone();
  }

  /** Forgets the results of before and calculates the page again, as a lazily loaded family has landed. */
  private reload(): void {
    this.last = [];
    this.flight = null;
    this.queued = false;
    if (this.members.size > 0) this.refresh();
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

  private remember(raws: readonly Table[], results: readonly Table[]): void {
    this.last = [{ raws, results }, ...this.last.filter((one) => !same(one.raws, raws))].slice(0, 2);
  }

  /** The results of a recent calculation, when it was made from exactly these tables. */
  private known(raws: readonly Table[]): readonly Table[] | null {
    return this.last.find((one) => same(one.raws, raws))?.results ?? null;
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
    this.remember(raws, results);
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
    // The job in flight is for exactly these cells: its answer is the one to wait for.
    if (this.flight && same(this.flight, raws)) {
      this.queued = false;
      return;
    }
    const give = (generation: number, results: readonly Table[], busy: boolean) => {
      if (generation !== this.generation) return;
      if (!busy) {
        this.remember(raws, results);
        this.working(members, false);
      }
      members.forEach((member, i) => this.members.has(member) && member.calculated(results[i], busy, raws[i]));
    };
    const known = this.known(raws);
    if (known) return give(++this.generation, known, false);
    if (!needsWorker(raws, this.options.threshold ?? WORKER_CELLS)) {
      return give(++this.generation, recalculateBook(raws, this.env), false);
    }
    // The worker runs one job at a time. While one runs, an edit only marks the page to go again: when the answer
    // comes, the newest cells go in one job, so slow typing never queues a job for each keystroke.
    if (this.flight) {
      this.queued = true;
      return;
    }
    const generation = ++this.generation;
    this.client ??= createRecalcClient(this.options);
    this.flight = raws;
    // The worker's answer. An answer for cells edited since is dropped, and the newest cells go to the worker. The
    // tables stop being busy at once, and draw their results in a task of their own, so the task that brings the
    // answer stays short and a frame never waits for both.
    const answer = (results: readonly Table[], busy: boolean) => {
      const current = generation === this.generation && !this.queued;
      if (current && !busy) this.working(members, false);
      if (current) setTimeout(() => give(generation, results, busy), 0);
      if (busy || this.flight !== raws) return;
      this.flight = null;
      if (!this.queued) return;
      this.queued = false;
      this.refresh();
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

  /**
   * True when the page goes to the worker with `cells` cells in the member's table. It reads the other tables' cells
   * from what they hold now, so an edit on a large page skips preparing a table nobody would calculate here.
   */
  overThreshold(member: BookMember, cells: number): boolean {
    let total = cells;
    for (const one of this.members) if (one !== member) total += cellCount([one.raw()]);
    return total > (this.options.threshold ?? WORKER_CELLS);
  }
}

const same = (a: readonly Table[], b: readonly Table[]) => a.length === b.length && a.every((one, i) => one === b[i]);

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

// Reading a cell's Markdown parses it, which adds up on a large table with each edit. Most cells do not change
// between edits, and many hold the same text, so the text of each Markdown is kept. The cap bounds the memory.
const READ_CAP = 100_000;
const read = new Map<string, string>();

function textOf(markdown: string): string {
  if (markdown === '') return '';
  let text = read.get(markdown);
  if (text === undefined) {
    if (read.size >= READ_CAP) read.clear();
    text = readableText(markdown);
    read.set(markdown, text);
  }
  return text;
}

/** The typed text of a table's cells, read from its Markdown as the editor shows it. */
export function gridOfData(data: TableData): Grid {
  const columnIds = data.columns.map((column) => column.id);
  const texts = data.rows.map((row) =>
    columnIds.map((id) => textOf(Object.hasOwn(row.cells, id) ? row.cells[id].markdown : '')),
  );
  return { header: data.header, columnIds, texts };
}

/** True when two grids hold the same text in every cell. */
export function sameTexts(a: Grid['texts'], b: Grid['texts']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r += 1) {
    const x = a[r];
    const y = b[r];
    if (x.length !== y.length) return false;
    for (let c = 0; c < x.length; c += 1) if (x[c] !== y[c]) return false;
  }
  return true;
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
