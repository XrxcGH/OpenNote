// Deck import and export for text and CSV (Study tools). Each import becomes a deck of its own. Cards already in
// a deck are found before anything is added, and what could not be read is counted with its line.
import { fromAnkiCloze } from './cloze';
import { cardOfLine } from './inline';
import { newId } from './library';
import type { Card, Deck } from './types';

export interface Skipped {
  line: number;
  reason: 'empty' | 'noAnswer';
}

export interface Parsed {
  cards: Card[];
  skipped: Skipped[];
}

const MAX_CELL = 4000;
const BOM = String.fromCharCode(0xfeff);

/** Splits delimited text into rows, honouring quotes and picking the tab, semicolon, or comma used most. */
export function parseDelimited(text: string): string[][] {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const first = body.split('\n', 1)[0] ?? '';
  const count = (char: string) => first.split(char).length;
  const delimiter = count('\t') > 1 ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const HEADERS = new Set(['front', 'question', 'term', 'prompt']);

/** Cards from rows of cells: the first cell is the front, the second the back. A header row is left out. */
export function cardsFromRows(rows: readonly string[][]): Parsed {
  const cards: Card[] = [];
  const skipped: Skipped[] = [];
  rows.forEach((row, index) => {
    const front = fromAnkiCloze((row[0] ?? '').trim()).slice(0, MAX_CELL);
    const back = (row[1] ?? '').trim().slice(0, MAX_CELL);
    if (index === 0 && HEADERS.has(front.toLowerCase())) return;
    if (!front && !back) return void skipped.push({ line: index + 1, reason: 'empty' });
    const cloze = /\{\{[^{}]+?\}\}/.test(front);
    if (!cloze && (!front || !back)) return void skipped.push({ line: index + 1, reason: 'noAnswer' });
    cards.push({ id: newId('c'), kind: cloze ? 'cloze' : 'basic', front, back: cloze ? back : back, origin: 'import' });
  });
  return { cards, skipped };
}

/** Cards from plain lines: "Question :: Answer", "Question<TAB>Answer", or a line with {{blanks}}. */
export function cardsFromText(text: string): Parsed {
  const cards: Card[] = [];
  const skipped: Skipped[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const tab = line.split('\t');
    const made =
      tab.length > 1 ? { kind: 'basic' as const, front: tab[0].trim(), back: tab[1].trim() } : cardOfLine(line);
    if (!made || !made.front || (made.kind === 'basic' && !made.back))
      return void skipped.push({ line: index + 1, reason: 'noAnswer' });
    cards.push({ id: newId('c'), origin: 'import', ...made });
  });
  return { cards, skipped };
}

/** Text that looks like CSV or TSV is read as rows; anything else as plain lines. */
export function parseCards(text: string, fileName = ''): Parsed {
  const name = fileName.toLowerCase();
  const delimited =
    /\.(csv|tsv)$/.test(name) || (!name.endsWith('.txt') && /^[^\n]*(?:,|\t|;)/.test(text) && !text.includes(' :: '));
  return delimited ? cardsFromRows(parseDelimited(text)) : cardsFromText(text);
}

const key = (card: Pick<Card, 'front' | 'back'>): string =>
  `${card.front}\u0001${card.back}`.toLowerCase().replace(/\s+/g, ' ').trim();

export interface ImportPlan {
  fresh: Card[];
  /** Cards that match one already in the deck, or one earlier in the same file. */
  duplicates: Card[];
}

/** Sorts incoming cards into those to add and those that repeat a card already there. */
export function planImport(incoming: readonly Card[], existing: readonly Card[]): ImportPlan {
  const seen = new Set(existing.map(key));
  const plan: ImportPlan = { fresh: [], duplicates: [] };
  for (const card of incoming) {
    const id = key(card);
    if (seen.has(id)) plan.duplicates.push(card);
    else {
      seen.add(id);
      plan.fresh.push(card);
    }
  }
  return plan;
}

const quote = (cell: string): string => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** The deck as CSV with Front and Back columns. Image cards can't be written as text and are counted instead. */
export function deckToCsv(deck: Deck): { csv: string; skipped: number } {
  const rows: string[][] = [['Front', 'Back']];
  let skipped = 0;
  for (const card of deck.cards) {
    if (card.kind === 'occlusion') skipped += 1;
    else if (card.kind === 'choice') {
      const options = (card.choices ?? []).join(' | ');
      rows.push([
        card.front,
        [card.choices?.[card.answer ?? 0] ?? '', options && `Options: ${options}`].filter(Boolean).join('\n'),
      ]);
    } else rows.push([card.front, card.back]);
  }
  return { csv: rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n', skipped };
}
