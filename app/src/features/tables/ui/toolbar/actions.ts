// What the cell format bar's buttons, the palette commands, and the context menu entries do. Every action reads the
// selection of the table block's own editor: whole cells, or the cell holding the caret. A change to a whole cell is
// one data patch (sheet/formatTarget.ts), so Undo takes it back in one step. Bold, Italic, Underline, Strikethrough,
// and Text color run the shared commands: they write the cell style when whole cells are selected, and a mark when
// text is, which is the format target seam's job.
import { CellSelection } from '@tiptap/pm/tables';
import { runEditorCommand } from '../../../../editor/commands/catalog';
import { t } from '../../../../strings/t';
import type { TableExtraHost } from '../../../page';
import { appLocale } from '../../smart/locale';
import { boxOfSelection, planFormat, styleAt, writeFormat } from '../../sheet/formatTarget';
import type { CellBox } from '../../sheet/formatTarget';
import { readSheet } from '../../sheet/model';
import type { CellStyle, StyleChange } from '../../sheet/model';
import { BORDER_LABELS, bordersFor } from './borders';
import type { BorderId, Line } from './borders';
import { FORMAT_CHOICES, stepDecimals, toggleThousands, currencyCode } from './numberFormats';

/** The line style and color the borders menu draws with. It stays for the session, as Excel's does. */
export const borderLine: Line = { style: 'thin' };

/** Changes the line the borders menu draws with. A color of null is Automatic. */
export function setBorderLine(change: { style?: string; color?: string | null }): void {
  if (change.style !== undefined) borderLine.style = change.style;
  if (change.color === null) delete borderLine.color;
  else if (change.color !== undefined) borderLine.color = change.color;
}

export interface Cells {
  box: CellBox;
  /** The style of the first cell, as the table draws it. */
  style: CellStyle;
  /** True when whole cells are selected, so the shared commands write cell styles. */
  whole: boolean;
}

/** The cells the selection is on, or null when the selection is not in the table's cells. */
export function cellsOf(host: TableExtraHost): Cells | null {
  const state = host.editor.state;
  const table = host.table();
  const box = boxOfSelection(state, table);
  if (!box) return null;
  const style = styleAt(readSheet(host.data()), table, box.top, box.left);
  return { box, style, whole: state.selection instanceof CellSelection };
}

/** Applies a change to the cells and removes the marks `strip` from their text. */
export async function setCells(
  host: TableExtraHost,
  change: StyleChange,
  strip: readonly string[] = [],
): Promise<boolean> {
  const cells = cellsOf(host);
  if (!cells) return false;
  return writeFormat(host, [{ box: cells.box, change }], strip, cells.box);
}

/** Fill color: a stored color, or null for No color (written as `none`, so a look's fill does not show through). */
export async function setFill(host: TableExtraHost, color: string | null): Promise<boolean> {
  const done = await setCells(host, { fill: color ?? 'none' });
  if (done)
    host.announce(color === null ? t('sheetToolbar.announce.fillNone') : t('sheetToolbar.announce.fill', { color }));
  return done;
}

/** Text color through the shared command: the cell's font color for whole cells, a mark for selected text. */
export function setTextColor(host: TableExtraHost, color: string | null): boolean {
  return runEditorCommand(host.editor, 'format.textColor', { color: color as string });
}

export async function setBorders(host: TableExtraHost, id: BorderId): Promise<boolean> {
  const cells = cellsOf(host);
  if (!cells) return false;
  const done = await writeFormat(host, bordersFor(id, cells.box, borderLine), [], cells.box);
  if (done) host.announce(t('sheetToolbar.announce.borders', { name: t(BORDER_LABELS[id]) }));
  return done;
}

export const setAlignH = (host: TableExtraHost, h: 'left' | 'center' | 'right' | 'justify') =>
  setCells(host, { align: { h } });

export const setAlignV = (host: TableExtraHost, v: 'top' | 'middle' | 'bottom') => setCells(host, { align: { v } });

export const setWrap = (host: TableExtraHost, wrap: 'wrap' | 'overflow' | 'clip') =>
  setCells(host, { align: { wrap } });

/** Text rotation: degrees from -90 to 90, or stacked letters. 0 takes the rotation off. */
export const setRotate = (host: TableExtraHost, rotate: number | 'stacked') =>
  setCells(host, { align: { rotate: rotate === 0 ? null : rotate } });

/** A number format code, or null for General. */
export async function setFormat(host: TableExtraHost, code: string | null): Promise<boolean> {
  const done = await setCells(host, { fmt: code });
  if (done) host.announce(t('sheetToolbar.announce.format', { format: code ?? 'General' }));
  return done;
}

export const setChoice = (host: TableExtraHost, id: string) => {
  const choice = FORMAT_CHOICES.find((one) => one.id === id);
  return choice ? setFormat(host, choice.code(appLocale())) : Promise.resolve(false);
};

export const setCurrency = (host: TableExtraHost) => setFormat(host, currencyCode(appLocale()));
export const setPercent = (host: TableExtraHost) => setFormat(host, '0%');

export function changeDecimals(host: TableExtraHost, direction: 1 | -1): Promise<boolean> {
  const cells = cellsOf(host);
  if (!cells) return Promise.resolve(false);
  const next = stepDecimals(cells.style.fmt, direction);
  return setFormat(host, next);
}

export function changeThousands(host: TableExtraHost): Promise<boolean> {
  const cells = cellsOf(host);
  return cells ? setFormat(host, toggleThousands(cells.style.fmt)) : Promise.resolve(false);
}

/** Clear formats: every cell format of the cells, and the marks in their text. */
export async function clearFormats(host: TableExtraHost): Promise<boolean> {
  const cells = cellsOf(host);
  if (!cells) return false;
  const plan = planFormat({ format: 'clear' }, cells.box, cells.style);
  if (!plan) return false;
  const done = await writeFormat(host, plan.steps, plan.strip, cells.box);
  if (done) host.announce(t('sheetToolbar.announce.cleared'));
  return done;
}
