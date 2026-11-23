// Opens the Format Cells dialog for the current table (Ctrl+1). It reads the selected cells, and OK writes what
// changed as one data patch together with the marks the new cell-wide formats replace, so Undo takes it all back in
// one step (the same write the format bar makes: sheet/formatTarget.ts writeFormat).
import type { CellSelection } from '@tiptap/pm/tables';
import { sessionStore } from '../../../../state/session';
import { t } from '../../../../strings/t';
import type { TableExtraHost } from '../../../page';
import { boxOfSelection, styleAt, writeFormat } from '../../sheet/formatTarget';
import type { Step } from '../../sheet/formatTarget';
import { readSheet } from '../../sheet/model';
import type { CellStyle, StyleChange } from '../../sheet/model';
import { isObject } from '../../sheet/model/json';
import { currentScheme } from '../../sheet/render/plugin';
import { appLocale } from '../../smart/locale';
import { edgesOf } from './edges';
import { FormatCells } from './FormatCells';
import { showDialog } from './mount';
import { sampleOf } from './numberCodes';

/** The notebook the page is in, whose recent colors the palette keeps. */
export function notebookOf(): string {
  const { location } = sessionStore.get();
  return 'notebookId' in location && location.notebookId ? location.notebookId : 'notebook';
}

/** The text marks that a cell-wide font format replaces, by the font property that changed. */
const MARKS: Readonly<Record<string, readonly string[]>> = {
  bold: ['bold', 'weight'],
  italic: ['italic'],
  underline: ['underline'],
  strike: ['strike'],
  color: ['textColor'],
  size: ['textSize'],
  family: ['font'],
  script: ['subscript', 'superscript'],
};

/** The marks to take off the cells' text so the changed font properties show. */
export function marksFor(change: StyleChange | null): string[] {
  const font = change?.font;
  if (!font || typeof font !== 'object') return [];
  return Object.keys(font).flatMap((key) => MARKS[key] ?? []);
}

/** Every number format code the sheet's styles use, in order, once each. */
export function usedCodes(sheet: ReturnType<typeof readSheet>): string[] {
  const styles = isObject(sheet.styles) ? Object.values(sheet.styles) : [];
  const codes = styles.map((style) => (isObject(style) ? style.fmt : undefined));
  return [...new Set(codes.filter((code): code is string => typeof code === 'string'))];
}

/** Writes the dialog's result: the property changes of the whole selection and the edge steps. */
export async function writeDialog(
  host: TableExtraHost,
  box: Step['box'],
  change: StyleChange | null,
  edgeSteps: Step[],
): Promise<boolean> {
  const steps: Step[] = [...(change ? [{ box, change }] : []), ...edgeSteps];
  if (steps.length === 0) {
    host.announce(t('sheetFormat.announce.nothing'));
    return false;
  }
  const done = await writeFormat(host, steps, marksFor(change), box);
  host.announce(t(done ? 'sheetFormat.announce.applied' : 'sheetFormat.announce.nothing'));
  return done;
}

/** The text of the cell the selection is in, from the live editor (the block's data may lag a keystroke behind). */
function liveCellText(host: TableExtraHost): string | undefined {
  const { selection } = host.editor.state;
  if ('$anchorCell' in selection) return (selection as CellSelection).$anchorCell.nodeAfter?.textContent;
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    const role = selection.$from.node(depth).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') return selection.$from.node(depth).textContent;
  }
  return undefined;
}

/** Shows the dialog on the selected cells of a table. Resolves when it closes. */
export function openFormatCells(host: TableExtraHost, tab?: 'number' | 'alignment' | 'font' | 'border' | 'fill') {
  const table = host.table();
  const box = boxOfSelection(host.editor.state, table);
  if (!box) return Promise.resolve();
  const sheet = readSheet(host.data());
  const style: CellStyle = styleAt(sheet, table, box.top, box.left);
  const text = liveCellText(host) ?? table.rows[box.top].cells[table.columns[box.left].id]?.markdown;
  return showDialog((close) => (
    <FormatCells
      style={style}
      box={box}
      edges={edgesOf(sheet, table, box)}
      sample={sampleOf(text)}
      locale={appLocale()}
      scheme={currentScheme()}
      notebookId={notebookOf()}
      usedCodes={usedCodes(sheet).filter((code) => code !== style.fmt)}
      initialTab={tab}
      onCancel={() => {
        close();
        host.editor.commands.focus();
      }}
      onApply={(change, steps) => {
        close();
        void writeDialog(host, box, change, steps).then(() => host.editor.commands.focus());
      }}
    />
  ));
}
