// Study tape in print and export. Tape hides content on screen only; for a worksheet the covered content becomes
// blanks, and an answer key at the end of the page lists what was under each one. This works on page data, before
// any format is written, so print, PDF, pictures, Markdown, and the web page all read the same blanks. The tape is
// matched to the blocks it covers by their boxes: a block is covered when most of it lies under a tape.
import type { ExportBlock, ExportPage, TableBlock, TextBlock } from './source';

export interface TapeBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TapeLabels {
  /** The heading of the answer key. */
  readonly answerKey: string;
  /** What stands for a covered picture, drawing, or table in the key. */
  readonly picture: string;
  readonly drawing: string;
  readonly table: string;
}

export const ENGLISH_TAPE_LABELS: TapeLabels = {
  answerKey: 'Answer key',
  picture: 'picture',
  drawing: 'drawing',
  table: 'table',
};

const isTape = (block: ExportBlock) => block.type === 'other' && block.kind === 'tape';

/** The box of a block: its frame when it floats, otherwise the box the page view laid it out in. */
function boxOf(block: ExportBlock, boxes: ReadonlyMap<string, TapeBox>): TapeBox | null {
  const frame = block.frame;
  if (frame && frame.x !== undefined && frame.y !== undefined && frame.w !== undefined && frame.h !== undefined) {
    return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  }
  return boxes.get(block.id) ?? null;
}

function overlap(a: TapeBox, b: TapeBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The IDs of the blocks that lie mostly (at least half their area) under a tape. */
export function coveredBlocks(page: ExportPage, boxes: ReadonlyMap<string, TapeBox>): Set<string> {
  const tapes = page.blocks.filter(isTape).flatMap((tape) => boxOf(tape, boxes) ?? []);
  const covered = new Set<string>();
  if (tapes.length === 0) return covered;
  for (const block of page.blocks) {
    if (isTape(block)) continue;
    const box = boxOf(block, boxes);
    if (!box || box.w <= 0 || box.h <= 0) continue;
    const under = tapes.reduce((sum, tape) => sum + overlap(box, tape), 0);
    if (under >= (box.w * box.h) / 2) covered.add(block.id);
  }
  return covered;
}

/** Text with each word turned into a blank of about the same length. Markdown marks and spaces stay. */
export function blankText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const lead = /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)?/.exec(line)?.[0] ?? '';
      const rest = line.slice(lead.length);
      return lead + rest.replace(/\S+/g, (word) => '_'.repeat(Math.min(Math.max([...word].length, 3), 14)));
    })
    .join('\n');
}

const plain = (markdown: string) => markdown.trim().replace(/\s+/g, ' ');

function blankTable(block: TableBlock): TableBlock {
  return {
    ...block,
    rows: block.rows.map((row, index) =>
      block.header && index === 0
        ? row
        : { ...row, cells: Object.fromEntries(Object.entries(row.cells).map(([id, cell]) => [id, blankText(cell)])) },
    ),
  };
}

function keyBlock(id: string, order: string, markdown: string): TextBlock {
  return { id, order, type: 'text', markdown };
}

/**
 * The page with what the tape covers turned into blanks, the tape itself left out, and an answer key on the end.
 * A page with no tape over anything comes back as it was.
 */
export function withBlanks(
  page: ExportPage,
  boxes: ReadonlyMap<string, TapeBox>,
  labels: TapeLabels = ENGLISH_TAPE_LABELS,
): ExportPage {
  const covered = coveredBlocks(page, boxes);
  if (covered.size === 0) return page;
  const answers: string[] = [];
  const blocks: ExportBlock[] = [];
  const inkGone = new Set<string>();
  for (const block of page.blocks) {
    if (isTape(block)) continue;
    if (!covered.has(block.id)) {
      blocks.push(block);
      continue;
    }
    switch (block.type) {
      case 'text':
        answers.push(plain(block.markdown));
        blocks.push({ ...block, markdown: blankText(block.markdown) });
        break;
      case 'table': {
        const cells = block.rows.slice(block.header ? 1 : 0).flatMap((row) => Object.values(row.cells));
        answers.push(plain(cells.join(', ')) || labels.table);
        blocks.push(blankTable(block));
        break;
      }
      case 'image':
        answers.push(block.decorative || block.alt === '' ? labels.picture : block.alt);
        break;
      case 'ink':
        answers.push(block.alt === '' ? labels.drawing : block.alt);
        inkGone.add(block.id);
        break;
      default:
        blocks.push(block);
    }
  }
  const last = page.blocks.reduce((max, block) => (block.order > max ? block.order : max), '');
  const key: ExportBlock[] = [
    keyBlock('answer-key-title', `${last}~0`, `## ${labels.answerKey}`),
    keyBlock('answer-key', `${last}~1`, answers.map((answer, index) => `${index + 1}. ${answer}`).join('\n')),
  ];
  return {
    ...page,
    blocks: [...blocks, ...key],
    strokes: page.strokes.filter((stroke) => !inkGone.has(stroke.block)),
  };
}
