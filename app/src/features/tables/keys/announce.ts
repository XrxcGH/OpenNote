// What a screen reader hears in a table's Grid mode (DESIGN.md section 17): the address, the column header, the
// shown value, and "formula" with the formula read as words. "C4, Total, 10, formula equals B4 times 2".
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';

const QUOTED = /("(?:[^"]|"")*")/;
// Longest first, so "<=" is read before "<".
const OPERATORS: readonly (readonly [RegExp, MessageKey])[] = [
  [/<>/g, 'sheetKeys.words.notEqual'],
  [/<=/g, 'sheetKeys.words.lessOrEqual'],
  [/>=/g, 'sheetKeys.words.greaterOrEqual'],
  [/</g, 'sheetKeys.words.less'],
  [/>/g, 'sheetKeys.words.greater'],
  [/=/g, 'sheetKeys.words.equals'],
  [/\+/g, 'sheetKeys.words.plus'],
  [/-/g, 'sheetKeys.words.minus'],
  [/\*/g, 'sheetKeys.words.times'],
  [/\//g, 'sheetKeys.words.dividedBy'],
  [/\^/g, 'sheetKeys.words.power'],
  [/&/g, 'sheetKeys.words.join'],
  [/%/g, 'sheetKeys.words.percent'],
  [/:/g, 'sheetKeys.words.through'],
];

/**
 * A formula read as words: "=B4*2" is "equals B4 times 2" and "=SUM(B2:B4)" is "equals SUM(B2 through B4)". Text
 * in quotes is read as it is.
 */
export function formulaWords(formula: string): string {
  return formula
    .split(QUOTED)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      // Each operator becomes a private-use mark first, so a word never holds another operator's sign.
      const words: string[] = [];
      let marked = part;
      for (const [sign, key] of OPERATORS) {
        marked = marked.replace(sign, () => ` \u{E000}${words.push(t(key)) - 1}\u{E001} `);
      }
      return marked.replace(/\u{E000}(\d+)\u{E001}/gu, (_, n: string) => words[Number(n)]);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CellSpeech {
  /** "C4", or the column letter alone in the header row. */
  address: string;
  /** The column's header text, or null when the table has no header row. */
  header: string | null;
  /** What the cell shows: a formula's result, or its text. */
  shown: string;
  /** The formula, with its "=", when the cell holds one. */
  formula: string | null;
  /** Whether the cell is in the header row. */
  isHeader?: boolean;
}

/** The announcement for a cell that became the active cell. */
export function cellAnnouncement(cell: CellSpeech): string {
  const value = cell.shown.trim() === '' ? t('sheetKeys.announce.blank') : cell.shown.trim();
  if (cell.isHeader) return t('sheetKeys.announce.headerCell', { address: cell.address, value });
  const header = cell.header?.trim() || null;
  const formula = cell.formula ? formulaWords(cell.formula) : null;
  if (header && formula) return t('sheetKeys.announce.cellFormula', { address: cell.address, header, value, formula });
  if (header) return t('sheetKeys.announce.cell', { address: cell.address, header, value });
  if (formula) return t('sheetKeys.announce.cellNoHeaderFormula', { address: cell.address, value, formula });
  return t('sheetKeys.announce.cellNoHeader', { address: cell.address, value });
}

/** The announcement for a range: "B2 through C3 selected, 4 cells". */
export function rangeAnnouncement(from: string, to: string, count: number): string {
  return t('sheetKeys.announce.range', { from, to, count });
}
