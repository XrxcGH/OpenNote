// Makes a table block smart (Phase 7). The table block hands over its editor and its data (tables/extras.ts). This
// adds the plugin that draws results over cells, the strip and charts below the table, and the instance the
// commands act on. It reads the cells again a moment after typing stops, so typing never waits for a recalculation.
import { CellSelection } from '@tiptap/pm/tables';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { cellAt } from '../../../editor/commands/tables';
import { t } from '../../../strings/t';
import { openMenu } from '../../../ui';
import type { TableData } from '../../../editor/schema/specs';
import type { BlockJson } from '../../../services/pages/types';
import type { TableExtraHandle, TableExtraHost } from '../../page';
import { columnLetter, formatValue, totalsRow, hasTotals } from '../engine';
import type { Table } from '../engine';
import { WORKER_CELLS } from '../engine/worker/client';
import { readSheet } from '../sheet/model';
import type { Sheet } from '../sheet/model';
import { applyPatch } from '../sheet/model/json';
import type { Json } from '../sheet/model/json';
import { currentScheme, refreshSheetRender, sheetRenderKey, sheetRenderPlugin } from '../sheet/render';
import type { SheetSource } from '../sheet/render';
import { bookFor, gridOfData, sheetAfter, valuesPatch } from './book';
import type { BookMember, PageBook } from './book';
import { chartSpec } from './chartSpec';
import { Chrome } from './Chrome';
import type { ChartItem, ChromeProps } from './Chrome';
import type { ChartSmart, SmartData } from './data';
import { readSmart, sameSmart, smartPatch } from './data';
import { buildDecorations, displayKey, displayPlugin, displayState, gridOf } from './display';
import { appLocale } from './locale';
import { chartMenu, dataMenu, CHART_KINDS } from './menu';
import type { Prepared, SmartModel } from './model';
import { finishModel, prepareModel } from './model';
import { changeChart, chooseView, filterBy, removeChart, setCellText } from './ops';
import { autoSummary, factsOf } from './ChartAccess';
import type { Range, SmartInstance } from './ops';

const SETTLE_MS = 120;

/** The instance whose table had focus last, for the palette commands. */
let lastFocused: SmartInstance | null = null;
const live = new Set<SmartInstance>();
const claim = (instance: SmartInstance) => {
  lastFocused = instance;
};

export function focusedSmart(): SmartInstance | null {
  if (lastFocused && live.has(lastFocused) && !lastFocused.host.editor.isDestroyed) return lastFocused;
  return null;
}

function kindName(kind: ChartSmart['kind']): string {
  return t(CHART_KINDS.find((entry) => entry.kind === kind)?.label ?? 'smart.chart.kinds.bar');
}

function chartItems(model: SmartModel, smart: SmartData, locale: ReturnType<typeof appLocale>): ChartItem[] {
  return smart.charts.map((chart): ChartItem => {
    const spec = chartSpec(model, chart, locale);
    const names = spec?.data.series.map((series) => series.name).join(', ') ?? '';
    const title =
      chart.title ??
      (spec ? t('smart.chart.defaultTitle', { values: names, category: spec.data.xName }) : kindName(chart.kind));
    const points = spec?.data.series[0]?.points.length ?? 0;
    const facts = spec ? factsOf(chart.kind, spec) : null;
    const automatic = facts
      ? autoSummary(facts, kindName(chart.kind), title)
      : t('smart.chart.summary', { kind: kindName(chart.kind), title, count: points });
    return {
      id: chart.id,
      kind: chart.kind,
      title,
      spec,
      patterns: chart.patterns === true,
      summary: chart.summary ?? automatic,
      automatic,
      custom: chart.summary !== undefined,
    };
  });
}

function totalItems(model: SmartModel, locale: ReturnType<typeof appLocale>): ChromeProps['totals'] {
  if (!hasTotals(model.table)) return [];
  const values = totalsRow(model.table, model.shown);
  return model.table.columns.flatMap((column, c) => {
    if (!column.total) return [];
    const counted = column.total === 'count' || column.total === 'checked';
    const shown = formatValue(values[c], counted ? { ...column, type: 'number', decimals: 0 } : column, locale);
    return [{ label: t(`smart.table.totalLabels.${column.total}`, { column: model.names[c] }), text: shown }];
  });
}

/** The selected cells by row and column, or the cell with the caret. */
function rangeOf(editor: TableExtraHost['editor']): Range | null {
  const { selection } = editor.state;
  if (selection instanceof CellSelection) {
    const at = (pos: typeof selection.$anchorCell) => ({ row: pos.index(pos.depth - 1), column: pos.index(pos.depth) });
    const [a, b] = [at(selection.$anchorCell), at(selection.$headCell)];
    return {
      row0: Math.min(a.row, b.row),
      row1: Math.max(a.row, b.row),
      col0: Math.min(a.column, b.column),
      col1: Math.max(a.column, b.column),
    };
  }
  const at = cellAt(editor.state);
  return at ? { row0: at.row, row1: at.row, col0: at.column, col1: at.column } : null;
}

const typedLabel = (typed: string) => t('smart.table.typed', { typed });

/** One smart table: its state, what it draws over the cells, and the strip and charts under them. */
class SmartTable implements SmartInstance, TableExtraHandle, BookMember {
  readonly locale = appLocale();
  readonly element: Element;
  private current: SmartData;
  private latest: SmartModel | null = null;
  private readonly book: PageBook;
  private prepared: { key: string; smart: SmartData; sheet: unknown; value: Prepared } | null = null;
  /** The page's last results for this table, and the cells they were calculated from. */
  private result: { raw: Table; table: Table } | null = null;
  private edited: { key: string; stored: unknown; patch: Record<string, unknown> | null } | null = null;
  private source: { data: unknown; value: SheetSource | null } | null = null;
  // The editor may have focus already, when the extra finishes loading after a click.
  private active: boolean;
  private menuOpen = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private gone = false;
  private readonly mount = document.createElement('div');
  private readonly root: Root = createRoot(this.mount);
  private readonly editor: TableExtraHost['editor'];

  constructor(readonly host: TableExtraHost) {
    this.editor = host.editor;
    this.element = host.element;
    this.current = readSmart(host.data());
    this.active = this.editor.isFocused || host.element.contains(document.activeElement);
    host.element.append(this.mount);
    this.book = bookFor(host.page);
    this.book.join(this);
    this.editor.registerPlugin(displayPlugin());
    this.editor.registerPlugin(sheetRenderPlugin({ source: () => this.sheetSource(), scheme: currentScheme }));
    this.editor.on('transaction', this.onTransaction);
    this.editor.on('selectionUpdate', this.onSelection);
    this.editor.on('focus', this.onFocus);
    host.element.addEventListener('focusin', this.onFocus);
    host.element.addEventListener('focusout', this.onFocusOut);
    live.add(this);
    if (this.active) claim(this);
    this.refresh();
  }

  smart = (): SmartData => this.current;
  caret = () => cellAt(this.editor.state);
  range = (): Range | null => rangeOf(this.editor);

  /** The block's data.sheet, when it has one. */
  private sheet(): Sheet | undefined {
    const data = this.host.data();
    return data.sheet && typeof data.sheet === 'object' ? readSheet(data) : undefined;
  }

  /** The cells the editor holds, read by the columns' types, before the formulas run. */
  private prepare(): Prepared {
    const data = this.host.table();
    const columnIds = data.columns.map((column) => column.id);
    const grid = gridOf(this.editor.state.doc, data.header, columnIds);
    const key = JSON.stringify(grid);
    const stored = this.host.data().sheet;
    const known = this.prepared;
    if (known && known.key === key && known.smart === this.current && known.sheet === stored) return known.value;
    const value = prepareModel(grid, this.current, this.locale, this.sheet());
    this.prepared = { key, smart: this.current, sheet: stored, value };
    return value;
  }

  raw = (): Table => this.prepare().raw;

  /** The model of `table`, or of the cells before calculation when `table` was made from another shape. */
  private finish(prepared: Prepared, table: Table): SmartModel {
    const raw = prepared.raw;
    const fits = table.rows.length === raw.rows.length && table.columns.length === raw.columns.length;
    this.latest = finishModel(prepared, fits ? table : raw, this.current);
    return this.latest;
  }

  /** The table as the editor holds it right now, calculated with the rest of the page. */
  model(): SmartModel {
    const prepared = this.prepare();
    const known = this.result?.raw === prepared.raw ? this.result.table : null;
    return this.finish(prepared, known ?? this.book.calculateNow(this) ?? this.result?.table ?? prepared.raw);
  }

  /** The worker calculates the page: the table says it is busy, for screen readers and the UI tests. */
  working(on: boolean): void {
    if (on) this.host.element.setAttribute('aria-busy', 'true');
    else this.host.element.removeAttribute('aria-busy');
  }

  /** The page's results for this table: draw them. Display only, so no undo step. */
  calculated(table: Table, busy: boolean): void {
    if (this.gone || this.editor.isDestroyed) return;
    const prepared = this.prepare();
    if (!busy) this.result = { raw: prepared.raw, table };
    const shown = this.finish(prepared, table);
    const set = buildDecorations(this.editor.state.doc, shown, this.current, this.locale, typedLabel);
    this.editor.view.dispatch(this.editor.state.tr.setMeta(displayKey, set).setMeta('addToHistory', false));
    this.render(shown);
  }

  /**
   * The formula results of the table an edit leaves, for the same patch (ADR 0061), as data.sheet.values. Only a
   * table that has data.sheet gets them, and only where sheet writes are on. On a page the worker calculates, the
   * results arrive after the edit is sent, so the cache stays marked stale (valuesOf) until an edit finds it fresh.
   */
  withEdit(data: TableData, extra?: Record<string, unknown>): Record<string, unknown> | null {
    if (!this.host.flag('tables.sheetWrites')) return null;
    const stored = this.host.data();
    const sheet = sheetAfter(stored, extra);
    if (!sheet) return null;
    // A table too large for the page's thread: the worker's results come after the edit, so skip the work here.
    if (data.rows.length * data.columns.length > WORKER_CELLS) return null;
    const key = JSON.stringify([data.header, data.columns, data.rows, extra ?? null]);
    if (this.edited && this.edited.key === key && this.edited.stored === stored) return this.edited.patch;
    const smart = extra?.smart === undefined ? stored.smart : applyPatch(stored.smart as Json, extra.smart as Json);
    const prepared = prepareModel(gridOfData(data), readSmart({ smart }), this.locale, sheet);
    const results = this.book.calculateNow(this, prepared.raw);
    const patch = results ? valuesPatch(stored, data, extra, results) : null;
    this.edited = { key, stored, patch };
    return patch;
  }

  /** What the sheet render plugin draws: the block's sheet and cells, the same object until the data changes. */
  private sheetSource(): SheetSource | null {
    const data = this.host.data();
    if (this.source?.data === data) return this.source.value;
    const sheet = this.sheet();
    const table = this.host.table();
    const value: SheetSource | null = sheet ? { sheet, table } : null;
    this.source = { data, value };
    return value;
  }

  async commit(next: SmartData, change?: (data: TableData) => TableData | null): Promise<void> {
    const before = this.current;
    this.current = next;
    this.refresh();
    // Only the keys that changed go, so keys a later version wrote stay. The rows and the new data go in one
    // step, so one Ctrl+Z puts both back.
    const patch = smartPatch(next, before);
    if (change && (await this.host.apply(change, patch))) return;
    await this.host.patch(patch);
  }

  private render(shown: SmartModel): void {
    const at = this.caret();
    const dataRow = at ? at.row - shown.offset : -1;
    const smart = this.current;
    const props: ChromeProps = {
      active: this.active || this.menuOpen,
      address: at && dataRow >= 0 ? `${columnLetter(at.column)}${dataRow + 1}` : null,
      filter:
        smart.filters.length > 0 && shown.shown.length < shown.table.rows.length
          ? { shown: shown.shown.length, total: shown.table.rows.length }
          : null,
      savedView:
        this.host.flag('tables.savedViews') && smart.savedActive
          ? (smart.saved?.find((one) => one.id === smart.savedActive)?.name ?? null)
          : null,
      totals: totalItems(shown, this.locale),
      charts: this.host.flag('tables.charts') ? chartItems(shown, smart, this.locale) : [],
      openData: (anchor) => void this.openData(anchor),
      clearFilter: () => void filterBy(this, 'clear'),
      chartMenu: (id, anchor) => void this.openChartMenu(id, anchor),
      removeChart: (id) => void removeChart(this, id),
      chartSummary: (id, text) => void changeChart(this, id, { summary: text ?? undefined }),
      views: this.host.flag('tables.views')
        ? {
            model: shown,
            smart,
            locale: this.locale,
            view: smart.view,
            choose: (view) => void chooseView(this, view),
            setCell: (row, column, text) => setCellText(this, row, column, text),
            announce: (text) => this.host.announce(text),
          }
        : null,
    };
    this.root.render(createElement(Chrome, props));
  }

  private async withMenu(work: Promise<unknown>): Promise<void> {
    this.menuOpen = true;
    try {
      await work;
    } finally {
      this.menuOpen = false;
      if (this.latest) this.render(this.latest);
    }
  }

  private openData(anchor: HTMLElement): Promise<void> {
    const returnFocus = this.editor.view.dom as HTMLElement;
    return this.withMenu(openMenu({ label: t('smart.table.data'), items: dataMenu(this), anchor, returnFocus }));
  }

  private openChartMenu(id: string, anchor: HTMLElement): Promise<void> {
    const items = chartMenu(this, id);
    return this.withMenu(openMenu({ label: t('smart.chart.options'), items, anchor, returnFocus: anchor }));
  }

  /** Calculates the page again; every table of it draws its results when they come (calculated). */
  private refresh(): void {
    if (this.gone || this.editor.isDestroyed) return;
    clearTimeout(this.timer);
    this.book.refresh();
  }

  private readonly onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
    if (!transaction.docChanged) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), SETTLE_MS);
  };

  private readonly onSelection = () => {
    // A selection made in this table is the table the commands act on, even if its focus event came first.
    if (this.editor.isFocused) claim(this);
    if (this.latest && !this.gone) this.render(this.latest);
  };

  private readonly onFocus = () => {
    this.active = true;
    claim(this);
    if (this.latest) this.render(this.latest);
  };

  private readonly onFocusOut = (event: FocusEvent) => {
    if (this.host.element.contains(event.relatedTarget as Node | null) || this.menuOpen) return;
    this.active = false;
    if (this.latest) this.render(this.latest);
  };

  update(block: BlockJson): void {
    if (this.source && this.source.data !== block.data && !this.editor.isDestroyed)
      refreshSheetRender(this.editor.view);
    const next = readSmart(block.data);
    if (sameSmart(next, this.current)) return;
    this.current = next;
    this.refresh();
  }

  destroy(): void {
    this.gone = true;
    clearTimeout(this.timer);
    live.delete(this);
    this.book.leave(this);
    if (lastFocused === this) lastFocused = null;
    if (!this.editor.isDestroyed) {
      this.editor.off('transaction', this.onTransaction);
      this.editor.off('selectionUpdate', this.onSelection);
      this.editor.off('focus', this.onFocus);
      this.editor.unregisterPlugin(displayState);
      this.editor.unregisterPlugin(sheetRenderKey);
    }
    this.host.element.removeEventListener('focusin', this.onFocus);
    this.host.element.removeEventListener('focusout', this.onFocusOut);
    // React warns when a root unmounts during another root's render, so it waits a task.
    setTimeout(() => {
      this.root.unmount();
      this.mount.remove();
    }, 0);
  }
}

export function attachSmart(host: TableExtraHost): TableExtraHandle {
  return new SmartTable(host);
}
