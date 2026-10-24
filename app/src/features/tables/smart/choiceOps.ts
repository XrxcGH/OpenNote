// What a person does with a choice column (Further features, Phase 7): make a column one, pick a value for a cell,
// edit the options, and show only one option's rows. Each is one undo step through the table block, like the other
// changes in ops.ts, and every one is also a palette command (commands.ts) and a Data menu item (menu.ts).
import { parseCell, serializeCell } from '../../../editor/markdown';
import { tableSchema } from '../../../editor/schema/schema';
import type { TableData } from '../../../editor/schema/specs';
import { t } from '../../../strings/t';
import { openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import { choiceOf, isPicked, optionsFromCells, optionsOfDrafts, pick, renamesOf, rewrite } from './choice';
import type { ChoiceInfo } from './choice';
import { editChoicesDialog } from './ChoiceEditor';
import type { ChoiceEdit } from './ChoiceEditor';
import { withColumn } from './data';
import type { FilterSmart, SmartData } from './data';
import { setCellText } from './ops';
import type { SmartInstance } from './ops';

/** The id, name, and settings of the column, or null when it is not a choice column. */
function choiceColumn(inst: SmartInstance, column: number) {
  const model = inst.model();
  const id = model.columnIds[column];
  const info = id === undefined ? null : choiceOf(inst.smart(), id);
  return info ? { id, info, name: model.names[column], model } : null;
}

/** Makes the column a choice column. Its options start as the values its cells already hold, so none is lost. */
export async function makeChoice(inst: SmartInstance, column: number, multi: boolean): Promise<boolean> {
  const model = inst.model();
  const id = model.columnIds[column];
  if (id === undefined) return false;
  const smart = inst.smart();
  const own = smart.columns[id] ?? {};
  const seeded = optionsFromCells(
    model.table.rows.map((row) => row.cells[column]?.raw ?? ''),
    multi,
  );
  const options = own.options?.length ? own.options : seeded;
  await inst.commit(
    withColumn(smart, id, {
      type: 'choice',
      multi: multi ? true : undefined,
      options: options.length > 0 ? [...options] : undefined,
      currency: undefined,
      decimals: undefined,
    }),
  );
  inst.host.announce(t(multi ? 'smart.choice.madeMany' : 'smart.choice.madeOne', { column: model.names[column] }));
  return true;
}

/** The cells of one column rewritten by `change`, as the table's data. Null when no cell changes. */
function rewriteColumn(
  inst: SmartInstance,
  column: number,
  info: ChoiceInfo,
  change: (name: string) => string | null,
): (data: TableData) => TableData | null {
  const offset = inst.model().offset;
  return (data) => {
    const id = data.columns[column]?.id;
    if (!id) return null;
    let changed = false;
    const rows = data.rows.map((row, r) => {
      if (r < offset) return row;
      const text = parseCell(row.cells[id]?.markdown ?? '').textContent;
      const next = rewrite(info, text, change);
      if (next === text) return row;
      changed = true;
      const markdown =
        next === ''
          ? ''
          : serializeCell(tableSchema.nodes.paragraph.create(null, tableSchema.text(next)), inst.host.cache);
      return { ...row, cells: { ...row.cells, [id]: { markdown } } };
    });
    return changed ? { ...data, rows } : null;
  };
}

/** Filters that name a renamed option follow it to the new name. */
function renameInFilters<T extends FilterSmart>(filters: readonly T[], id: string, renames: Map<string, string>): T[] {
  return filters.map((filter) => {
    const to = filter.column === id ? renames.get((filter.value ?? '').toLowerCase()) : undefined;
    return to === undefined ? filter : { ...filter, value: to };
  });
}

function renameInSmart(smart: SmartData, id: string, renames: Map<string, string>): SmartData {
  if (renames.size === 0) return smart;
  return {
    ...smart,
    filters: renameInFilters(smart.filters, id, renames),
    ...(smart.saved
      ? { saved: smart.saved.map((view) => ({ ...view, filters: renameInFilters(view.filters, id, renames) })) }
      : {}),
  };
}

/** Keeps the edited options. A renamed option is renamed in every cell that holds it, in the same undo step. */
export async function saveChoices(inst: SmartInstance, column: number, edit: ChoiceEdit): Promise<boolean> {
  const model = inst.model();
  const id = model.columnIds[column];
  if (id === undefined) return false;
  const renames = renamesOf(edit.drafts);
  const smart = renameInSmart(inst.smart(), id, renames);
  const options = optionsOfDrafts(edit.drafts);
  const next = withColumn(smart, id, {
    type: 'choice',
    multi: edit.multi ? true : undefined,
    options: options.length > 0 ? options : undefined,
  });
  const info: ChoiceInfo = { options, multi: edit.multi };
  const change =
    renames.size > 0 ? rewriteColumn(inst, column, info, (name) => renames.get(name.toLowerCase()) ?? name) : undefined;
  await inst.commit(next, change);
  inst.host.announce(t('smart.choice.saved', { column: model.names[column], count: options.length }));
  return true;
}

/** Opens the editor for the column, and keeps what it returns. */
export async function editChoices(inst: SmartInstance, column: number): Promise<boolean> {
  const found = choiceColumn(inst, column);
  if (!found) {
    inst.host.announce(t('smart.choice.notChoice'));
    return false;
  }
  const result = await editChoicesDialog(found.name, {
    drafts: found.info.options.map((option) => ({ name: option.name, color: option.color, was: option.name })),
    multi: found.info.multi,
  });
  return result ? saveChoices(inst, column, result) : false;
}

/** Where the menu for the caret's cell opens: just under the caret. */
function caretPoint(inst: SmartInstance): { x: number; y: number } {
  const view = inst.host.editor.view;
  const box = view.coordsAtPos(view.state.selection.from);
  return { x: box.left, y: box.bottom };
}

/**
 * Opens the list of options for the cell with the caret. A single choice closes at once; a column that takes several
 * stays open after each pick, with the new state, until Done or Escape.
 */
export async function chooseValue(inst: SmartInstance, column?: number): Promise<boolean> {
  const caret = inst.caret();
  const at = column ?? caret?.column ?? 0;
  const found = choiceColumn(inst, at);
  if (!found) {
    inst.host.announce(t('smart.choice.notChoice'));
    return false;
  }
  const row = caret ? caret.row - found.model.offset : -1;
  if (row < 0) {
    inst.host.announce(t('smart.choice.needCell'));
    return false;
  }
  let again: boolean;
  let pending: Promise<unknown> = Promise.resolve();
  let changed = false;
  do {
    again = false;
    const model = inst.model();
    const info = choiceOf(inst.smart(), found.id) ?? found.info;
    const text = model.table.rows[row]?.cells[at]?.raw ?? '';
    const choose = (next: string, name: string) => () => {
      again = info.multi && name !== '';
      changed = true;
      pending = setCellText(inst, row, at, next).then(() =>
        inst.host.announce(name === '' ? t('smart.choice.cleared') : t('smart.choice.picked', { text: next })),
      );
    };
    const items: MenuItemSpec[] = info.options.map((option) => ({
      id: `choice-${option.name}`,
      label: option.name,
      kind: info.multi ? 'checkbox' : 'radio',
      checked: isPicked(info, text, option.name),
      onSelect: choose(pick(info, text, option.name), option.name),
    }));
    items.push({
      id: 'choice-none',
      label: t('smart.choice.none'),
      separatorBefore: info.options.length > 0,
      disabled: text.trim() === '',
      onSelect: choose('', ''),
    });
    if (info.multi) items.push({ id: 'choice-done', label: t('smart.choice.done'), onSelect: () => {} });
    await openMenu({
      label: t('smart.choice.menuLabel', { column: found.name }),
      items,
      anchor: caretPoint(inst),
      returnFocus: inst.host.editor.view.dom as HTMLElement,
    });
    await pending;
  } while (again);
  return changed;
}

/** Shows only the rows that have the option, or with null shows every row again. */
export async function filterByChoice(inst: SmartInstance, column: number, name: string | null): Promise<boolean> {
  const found = choiceColumn(inst, column);
  if (!found) return false;
  const smart = inst.smart();
  const others = smart.filters.filter((filter) => filter.column !== found.id);
  if (name === null && others.length === smart.filters.length) return false;
  const filters: FilterSmart[] = name === null ? others : [...others, { column: found.id, op: 'has', value: name }];
  await inst.commit({ ...smart, filters });
  const shown = inst.model().shown.length;
  inst.host.announce(
    name === null
      ? t('smart.table.filterCleared')
      : t('smart.table.filtered', { shown, total: found.model.table.rows.length }),
  );
  return true;
}
