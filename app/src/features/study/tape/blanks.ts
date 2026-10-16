// Study tape in print and export (Study tools): turns what the tape covers into blanks and adds an answer key page at
// the end. Pure over export page data. Which blocks a tape covers comes from `coverage.ts`, which measures the screen.
import type { ExportBlock, ExportPage, TextBlock } from '../../pages';

/** The words the blanks and the key use. The caller supplies translations. */
export interface TapeLabels {
  readonly answerKey: string;
  readonly picture: string;
  readonly handwriting: string;
  readonly table: string;
  readonly attachment: string;
  /** What stands in the page for a covered picture, drawing, table, or attachment. */
  readonly covered: string;
}

/** The ID of the answer key block, so the HTML export can start it on a new sheet. */
export const ANSWER_KEY_ID = 'tape-answer-key';

const WORD = /[\p{L}\p{N}]+/gu;

/** Text with each word replaced by a line of its length (3 to 12 marks), leaving the Markdown marks around it. */
export function blankText(markdown: string): string {
  return markdown.replace(WORD, (word) => '_'.repeat(Math.max(3, Math.min(12, word.length))));
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

function answerOf(block: ExportBlock, labels: TapeLabels): string {
  switch (block.type) {
    case 'text':
      return oneLine(block.markdown);
    case 'image':
      return block.alt.trim() === '' ? labels.picture : block.alt.trim();
    case 'ink':
      return block.alt?.trim() ? block.alt.trim() : labels.handwriting;
    case 'table':
      return labels.table;
    case 'file':
      return labels.attachment;
    case 'diagram':
      return block.alt.trim() === '' ? labels.picture : block.alt.trim();
    case 'other':
      return block.fallback ? oneLine(block.fallback) : labels.attachment;
  }
}

function isTape(block: ExportBlock): boolean {
  // Study tape is stored as OpenNote's extension type; pages from before that fix name it "tape".
  return block.type === 'other' && (block.kind === 'ext:org.opennote/tape' || block.kind === 'tape');
}

/** The IDs of the study tape on the page. */
export function tapeIds(page: ExportPage): string[] {
  return page.blocks.filter(isTape).map((b) => b.id);
}

/**
 * The page with what each tape covers turned into blanks, the tape itself left out, and an answer key at the end.
 * `covered` maps a tape's block ID to the IDs of the blocks it covers. The key lists the answers in the order the
 * tapes read, one numbered line for each covered block. A page whose tape covers nothing is returned without a key.
 */
export function blankTape(
  page: ExportPage,
  covered: ReadonlyMap<string, readonly string[]>,
  labels: TapeLabels,
  order: readonly string[],
): ExportPage {
  const byId = new Map(page.blocks.map((b) => [b.id, b]));
  const blanked = new Map<string, ExportBlock>();
  const answers: string[] = [];
  for (const tapeId of order) {
    for (const id of covered.get(tapeId) ?? []) {
      const block = byId.get(id);
      if (!block || isTape(block) || blanked.has(id)) continue;
      answers.push(answerOf(block, labels));
      const replacement: TextBlock = {
        id: block.id,
        order: block.order,
        ...(block.frame ? { frame: block.frame } : {}),
        type: 'text',
        markdown: block.type === 'text' ? blankText(block.markdown) : labels.covered,
      };
      blanked.set(id, replacement);
    }
  }
  const blocks: ExportBlock[] = page.blocks.filter((b) => !isTape(b)).map((b) => blanked.get(b.id) ?? b);
  if (answers.length > 0) {
    const key = [`## ${labels.answerKey}`, '', ...answers.map((a, i) => `${i + 1}. ${a}`)].join('\n');
    blocks.push({ id: ANSWER_KEY_ID, order: '~', frame: { x: 0, y: 1e9 }, type: 'text', markdown: key });
  }
  const inkGone = new Set([...blanked.keys()].filter((id) => byId.get(id)?.type === 'ink'));
  return { ...page, blocks, strokes: page.strokes.filter((s) => !inkGone.has(s.block)) };
}
