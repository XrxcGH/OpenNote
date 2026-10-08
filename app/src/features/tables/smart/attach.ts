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
import type { BlockJson } from '../../../services/pages/types';
import type { TableExtraHandle, TableExtraHost } from '../../page';
import { columnLetter, formatValue, totalsRow, hasTotals } from '../engine';
import { chartSpec } from './chartSpec';
import { Chrome } from './Chrome';
import type { ChartItem, ChromeProps } from './Chrome';
import type { ChartSmart, SmartData } from './data';
import { readSmart, sameSmart, smartPatch } from './data';
import { buildDecorations, displayKey, displayPlugin, displayState, gridOf } from './display';
import { appLocale } from './locale';
import { chartMenu, dataMenu, CHART_KINDS } from './menu';
import type { SmartModel } from './model';
import { buildModel } from './model';
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
class SmartTable implements SmartInstance, TableExtraHandle {
  readonly locale = appLocale();
  private current: SmartData;
  private latest: SmartModel | null = null;
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
    this.current = readSmart(host.data());
    this.active = this.editor.isFocused || host.element.contains(document.activeElement);
    host.element.append(this.mount);
    this.editor.registerPlugin(displayPlugin());
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

  /** The table as the editor holds it right now. */
  model(): SmartModel {
    const data = this.host.table();
    const columnIds = data.columns.map((column) => column.id);
    this.latest = buildModel(gridOf(this.editor.state.doc, data.header, columnIds), this.current, this.locale);
    return this.latest;
  }

  async commit(next: SmartData): Promise<void> {
    this.current = next;
    this.refresh();
    await this.host.patch(smartPatch(next));
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

  private refresh(): void {
    if (this.gone || this.editor.isDestroyed) return;
    clearTimeout(this.timer);
    const shown = this.model();
    const set = buildDecorations(this.editor.state.doc, shown, this.current, this.locale, typedLabel);
    this.editor.view.dispatch(this.editor.state.tr.setMeta(displayKey, set).setMeta('addToHistory', false));
    this.render(shown);
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
    const next = readSmart(block.data);
    if (sameSmart(next, this.current)) return;
    this.current = next;
    this.refresh();
  }

  destroy(): void {
    this.gone = true;
    clearTimeout(this.timer);
    live.delete(this);
    if (lastFocused === this) lastFocused = null;
    if (!this.editor.isDestroyed) {
      this.editor.off('transaction', this.onTransaction);
      this.editor.off('selectionUpdate', this.onSelection);
      this.editor.off('focus', this.onFocus);
      this.editor.unregisterPlugin(displayState);
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
