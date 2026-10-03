// The table block (ARCHITECTURE.md section 13; owner: WP6). It shows a real <table> at once, then edits it in a
// table editor through the pool. Cell typing syncs through attachTableSync as a patch of the rows, flushed like
// text. A command that changes the table's shape changes its data first. It then sends its own patch and replaces
// the editor's document, so IDs follow rows and columns. Arrow keys leave a flowing table at its edges.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { commandContext } from '../../../commands/registry';
import { menuItemsFor } from '../../../commands/menus';
import { applyTableOp, cellAt, cellTextPos } from '../../../editor/commands/tables';
import type { CellAt, TableChange, TableOp } from '../../../editor/commands/tables';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { META_REMOTE } from '../../../editor/meta';
import { renderStatic } from '../../../editor/schema/dom';
import type { TableData } from '../../../editor/schema/specs';
import { docToTableData, normalizeTableData, sameTableData, tableDataToDoc } from '../../../editor/table/mapping';
import { tableName } from '../../../editor/table/tableKit';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { openMenu } from '../../../ui';
import { shownLayer } from '../mount';
import type { StaticPool } from '../pool/pool';
import { blockLaidOut } from '../seams/geometry';
import { acceptRemoteText, attachTableSync } from '../sync';
import type { TableSyncHandle } from '../sync';
import { currentTable } from '../tables/current';
import type { TableHandle } from '../tables/current';
import type { InnerView } from '../tables/lazyView';
import { attachColumnHandles } from '../tables/columnResize';
import '../tables/commands';
import { TableToolbar } from '../tables/TableToolbar';
import tableStyles from '../tables/tables.module.css';
import styles from './blocks.module.css';
import { placeBlock } from './textBlock';
import type { BlockRenderContext } from './types';

const ANNOUNCE: Partial<Record<TableOp['op'], MessageKey>> = {
  rowAbove: 'tables.announce.rowAdded',
  rowBelow: 'tables.announce.rowAdded',
  columnLeft: 'tables.announce.columnAdded',
  columnRight: 'tables.announce.columnAdded',
  deleteRow: 'tables.announce.rowDeleted',
  deleteColumn: 'tables.announce.columnDeleted',
};

/** What a screen reader hears after a table command. */
function announcement(op: TableOp, change: TableChange): string {
  const key = ANNOUNCE[op.op];
  if (key) return t(key);
  if (op.op === 'headerRow') return t(change.data.header ? 'tables.announce.headerOn' : 'tables.announce.headerOff');
  if (op.op === 'columnWidth') return t('tables.announce.width', { width: op.width });
  return t('tables.announce.rowMoved', { position: (change.caret?.row ?? 0) + 1 });
}

const isFloating = (block: BlockJson) => block.frame?.x !== undefined && block.frame?.y !== undefined;

/** The flowing block before or after this one, by the page's order on screen. */
function flowingNeighbor(element: HTMLElement, direction: -1 | 1): HTMLElement | null {
  const step = (at: Element) => (direction < 0 ? at.previousElementSibling : at.nextElementSibling);
  for (let at = step(element); at; at = step(at)) {
    if (at instanceof HTMLElement && at.dataset.blockId && !at.classList.contains(styles.floating)) return at;
  }
  return null;
}

const DIRECTIONS: Record<string, -1 | 1> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

/** The direction an arrow key leaves the table in, or 0 when the caret isn't at that edge. */
function leavingDirection(view: EditorView, event: KeyboardEvent): -1 | 0 | 1 {
  const direction = DIRECTIONS[event.key] ?? 0;
  if (!direction || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return 0;
  const at = cellAt(view.state);
  const table = view.state.doc.firstChild;
  if (!at || !table || !view.state.selection.empty) return 0;
  const lastRow = table.childCount - 1;
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
  const atEdge = vertical
    ? at.row === (direction < 0 ? 0 : lastRow)
    : direction < 0
      ? at.row === 0 && at.column === 0
      : at.row === lastRow && at.column === table.child(lastRow).childCount - 1;
  const side = vertical ? (direction < 0 ? 'up' : 'down') : direction < 0 ? 'left' : 'right';
  return atEdge && view.endOfTextblock(side) ? direction : 0;
}

/** The editors of mounted table blocks, so a test or the palette can find a table's handle. */
const handles = new WeakMap<Editor, TableHandle>();

export function tableHandleOf(editor: Editor): TableHandle | null {
  return handles.get(editor) ?? null;
}

class TableView implements InnerView {
  readonly editRoot: HTMLElement;
  readonly handle: TableHandle;
  private readonly scroller: HTMLElement;
  private readonly toolbarHost: HTMLElement;
  private readonly pool: Partial<StaticPool> & BlockRenderContext['pool'];
  private data: TableData;
  private editor: Editor | null = null;
  private sync: TableSyncHandle | null = null;
  private toolbar: Root | null = null;
  private widthOpen = false;
  private stopHandles = () => {};
  private stopActive = () => {};

  constructor(
    readonly element: HTMLElement,
    private current: BlockJson,
    private readonly ctx: BlockRenderContext,
  ) {
    this.data = normalizeTableData(current.data);
    this.pool = ctx.pool as Partial<StaticPool> & BlockRenderContext['pool'];
    element.classList.add(styles.block, tableStyles.wrapper);
    placeBlock(element, current);
    this.toolbarHost = element.appendChild(document.createElement('div'));
    this.scroller = element.appendChild(document.createElement('div'));
    this.scroller.className = tableStyles.scroller;
    this.editRoot = this.scroller.appendChild(document.createElement('div'));
    this.editRoot.className = `${styles.text} ${tableStyles.table}`;
    this.editRoot.dataset.scope = 'editor editor.table';
    this.handle = {
      block: current.id,
      can: (op) => applyTableOp(this.data, this.caretCell(), op) !== null,
      header: () => this.data.header,
      run: (op) => this.run(op),
      deleteTable: () => this.deleteTable(),
      selectAll: () => this.selectAll(),
      openColumnWidth: () => this.openColumnWidth(),
    };
    // Static first: the same DOM the editor will show, so nothing moves when it mounts.
    this.showStatic(tableDataToDoc(this.data));
    this.mountEditor();
  }

  private name(doc: PMNode): void {
    this.element.setAttribute('aria-label', tableName(doc));
  }

  private showStatic(doc: PMNode): void {
    renderStatic(doc, this.editRoot);
    this.editRoot.querySelectorAll('th').forEach((th) => th.setAttribute('scope', 'col'));
    this.editRoot.querySelector('table')?.setAttribute('aria-label', tableName(doc));
    this.name(doc);
  }

  private caretCell(): CellAt {
    return (this.editor && cellAt(this.editor.state)) || { row: 0, column: 0 };
  }

  /** The data with the editor's latest typing. */
  private latest(): TableData {
    if (this.editor) this.data = docToTableData(this.editor.state.doc, this.data, this.ctx.cache);
    return this.data;
  }

  /** Shows `next` in the editor without sending it, with the caret in `caret`. */
  private show(next: TableData, caret: CellAt | null): void {
    this.data = next;
    const editor = this.editor;
    if (!editor) return this.showStatic(tableDataToDoc(next));
    const { state } = editor;
    const doc = tableDataToDoc(next, editor.schema);
    const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content).setMeta(META_REMOTE, true);
    const pos = caret ? cellTextPos(tr.doc, caret) : null;
    if (pos !== null) tr.setSelection(TextSelection.create(tr.doc, pos));
    editor.view.dispatch(tr);
    this.name(editor.state.doc);
    blockLaidOut(this.current.id);
    this.renderToolbar();
  }

  private send(next: TableData, coalesce?: 'resize'): Promise<unknown> {
    const { header, columns, rows } = next;
    const block = this.current.id;
    return this.ctx.sync.send({
      edits: [{ edit: 'patchBlock', block, data: { header, columns, rows } }],
      ...(coalesce ? { coalesce: { kind: coalesce, target: block } } : {}),
    });
  }

  private async run(op: TableOp): Promise<boolean> {
    if (this.sync) await this.sync.flush('command');
    const change = applyTableOp(this.latest(), this.caretCell(), op);
    if (!change) return false;
    this.show(change.data, change.caret);
    this.editor?.commands.focus();
    this.ctx.host.announce(announcement(op, change));
    await this.send(change.data);
    return true;
  }

  private async deleteTable(): Promise<void> {
    if (this.sync) await this.sync.flush('command');
    const id = this.current.id;
    const before = flowingNeighbor(this.element, -1) ?? flowingNeighbor(this.element, 1);
    await this.ctx.sync.send({ edits: [{ edit: 'deleteBlocks', blocks: [id] }] });
    this.ctx.host.announce(t('tables.announce.tableDeleted'));
    shownLayer.get()?.remove(id);
    const next = before?.dataset.blockId;
    if (next && this.ctx.pool.mount(next, { kind: 'end' }, 'focus')) this.ctx.pool.editor(next)?.commands.focus('end');
    else before?.focus();
  }

  private selectAll(): void {
    const editor = this.editor;
    if (!editor) return;
    const { doc } = editor.state;
    const lastRow = doc.firstChild!.lastChild!;
    // From the first cell's start to the last cell's start.
    const head = doc.content.size - 2 - lastRow.lastChild!.nodeSize;
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(doc, 2, head)));
    editor.commands.focus();
    this.ctx.host.announce(t('tables.announce.selected'));
  }

  private openColumnWidth(): void {
    this.widthOpen = true;
    currentTable.set(this.handle);
    this.setCurrent(true);
  }

  private closeColumnWidth(width: number | null): void {
    this.widthOpen = false;
    this.renderToolbar();
    this.editor?.commands.focus();
    if (width !== null) void this.run({ op: 'columnWidth', width });
  }

  private renderToolbar(): void {
    if (currentTable.get() !== this.handle && !this.widthOpen) return;
    this.toolbar ??= createRoot(this.toolbarHost);
    const caret = this.caretCell();
    const columns = this.data.columns;
    this.toolbar.render(
      createElement(TableToolbar, {
        can: this.handle.can,
        header: this.data.header,
        run: (op: TableOp) => void this.run(op),
        more: (anchor: HTMLElement) => void this.openMore(anchor),
        width: columns[Math.min(caret.column, columns.length - 1)]?.width ?? 0,
        widthOpen: this.widthOpen,
        openWidth: this.handle.openColumnWidth,
        closeWidth: (width: number | null) => this.closeColumnWidth(width),
      }),
    );
  }

  private async openMore(anchor: HTMLElement): Promise<void> {
    const ids = ['table.moveRowUp', 'table.moveRowDown', 'table.select', 'table.deleteTable'];
    const items = menuItemsFor('page.table', commandContext('menu')).filter((item) => ids.includes(item.id));
    const returnFocus = this.editor?.view.dom ?? null;
    await openMenu({ label: t('tables.toolbar.more'), items, anchor, returnFocus });
  }

  private setCurrent(on: boolean): void {
    if (on) currentTable.set(this.handle);
    else if (currentTable.get() === this.handle) currentTable.set(null);
    this.element.toggleAttribute('data-current', on);
    if (on) this.renderToolbar();
  }

  private mountEditor(): void {
    if (this.editor || this.ctx.page.readOnly) return;
    const block = this.current.id;
    const editor = createBlockEditor(this.editRoot, tableDataToDoc(this.data), {
      kind: 'table',
      block,
      host: this.ctx.host,
    });
    this.editor = editor;
    editor.view.dom.setAttribute('data-app-menu', 'table');
    editor.view.dom.setAttribute('aria-label', t('tables.block'));
    editor.registerPlugin(this.edgeKeys());
    handles.set(editor, this.handle);
    this.pool.adopt?.(block, editor);
    this.sync = attachTableSync(editor, block, this.ctx.sync, (doc) => {
      this.data = docToTableData(doc, this.data, this.ctx.cache);
      return this.data;
    });
    this.stopActive = this.ctx.pool.onActiveChange((active) => {
      // Focus visiting the palette or a menu keeps this the current table.
      if (active !== null) this.setCurrent(active === block);
    });
    editor.on('focus', () => this.setCurrent(true));
    editor.on('selectionUpdate', () => this.renderToolbar());
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) this.afterTyping();
    });
    this.placeHandles();
  }

  /** Keeps the data, the name, and the column edges in step with the editor's document. */
  private afterTyping(): void {
    if (!this.editor) return;
    const before = this.data.columns;
    const data = docToTableData(this.editor.state.doc, this.data, this.ctx.cache);
    this.data = data;
    this.name(this.editor.state.doc);
    const moved =
      before.length !== data.columns.length || before.some((column, i) => column.width !== data.columns[i].width);
    if (moved) this.placeHandles();
  }

  /** Arrow keys at a flowing table's edges move to the flowing block beside it. */
  private edgeKeys(): Plugin {
    return new Plugin({
      key: new PluginKey('opennote.tableEdges'),
      props: {
        handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
          if (isFloating(this.current)) return false;
          const direction = leavingDirection(view, event);
          const neighbor = direction ? flowingNeighbor(this.element, direction) : null;
          const id = neighbor?.dataset.blockId;
          if (!neighbor || !id) return false;
          const target = direction < 0 ? { kind: 'end' as const } : { kind: 'start' as const };
          const next = this.ctx.pool.mount(id, target, 'focus');
          if (next) next.commands.focus(target.kind);
          else neighbor.focus();
          return true;
        },
      },
    });
  }

  private placeHandles(): void {
    this.stopHandles();
    const resize = (column: number, width: number) => this.resize(column, width);
    this.stopHandles = attachColumnHandles(this.scroller, this.data.columns, this.ctx.viewport, resize);
  }

  /** The end of a column edge drag: one change, coalesced with other resizes of the table. */
  private resize(column: number, width: number): void {
    const caret = this.editor ? this.caretCell() : null;
    const change = applyTableOp(this.latest(), { row: 0, column }, { op: 'columnWidth', width });
    if (!change) return this.placeHandles();
    this.show(change.data, caret);
    this.ctx.host.announce(t('tables.announce.width', { width: change.data.columns[column].width }));
    void this.send(change.data, 'resize');
  }

  update(next: BlockJson): void {
    this.current = next;
    placeBlock(this.element, next);
    const incoming = normalizeTableData(next.data);
    if (sameTableData(incoming, this.latest())) return;
    const caret = this.editor ? this.caretCell() : null;
    const rows = incoming.rows.length - 1;
    const columns = incoming.columns.length - 1;
    this.show(incoming, caret && { row: Math.min(caret.row, rows), column: Math.min(caret.column, columns) });
    // The core now holds these rows, so typing back to the old ones is still sent.
    if (this.sync) acceptRemoteText(this.sync, JSON.stringify({ rows: this.data.rows }));
  }

  measure() {
    const { element } = this;
    return { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
  }

  destroy(): void {
    this.stopHandles();
    this.stopActive();
    this.setCurrent(false);
    this.sync?.detach();
    if (this.pool.release) this.pool.release(this.current.id);
    else this.editor?.destroy();
    const root = this.toolbar;
    this.toolbar = null;
    // React warns when a root unmounts during another root's render, so it waits a task.
    if (root) setTimeout(() => root.unmount(), 0);
  }
}

export function createInner(wrapper: HTMLElement, block: BlockJson, ctx: BlockRenderContext): InnerView {
  return new TableView(wrapper, block, ctx);
}
