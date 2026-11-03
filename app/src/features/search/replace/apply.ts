// Replace across a notebook, the part that writes. Each page takes its changes in one batch, so the page's own undo
// reverses all of them at once; the Undo on the result goes further and puts back every page the replace touched.
// The page on screen takes its batch through its own queue: a second session's undo history goes when that session
// closes, so Ctrl+Z and Ctrl+Y on the page could undo a replace but never redo it.
import type { PagesClient } from '../../../platform/types';
import type { BlockJson, Edit } from '../../../services/pages/types';
import { fieldText, replaceAt, sameField } from './plan';
import type { Field, Match } from './plan';

/** One field of one block, as it was and as it became. */
export interface Written {
  page: string;
  block: string;
  field: Field;
  from: string;
  to: string;
}

export interface Replaced {
  /** The fields that changed, for Undo. */
  written: Written[];
  pages: number;
  matches: number;
  /** Matches whose text changed since the preview, so they were left alone. */
  skipped: number;
}

type Row = { id: string; cells?: Record<string, { markdown?: string }> };

/** The page on screen: its blocks as the core has them, its queue, and a way to show what it sent. */
export interface ShownTarget {
  readonly id: string;
  /** Sends what is typed and not sent yet, so the blocks below are the core's. */
  flush(): Promise<void>;
  blocks(): readonly BlockJson[];
  send(edits: Edit[]): Promise<void>;
  /** Shows an edit the queue sent, in the editor and the block layer. */
  show(edit: Edit): void;
}

/** The edits that give each block its new text. A table's cells go together as one new `rows`. */
function editsFor(blocks: readonly BlockJson[], writes: readonly Written[]): Edit[] {
  const edits: Edit[] = [];
  for (const block of blocks) {
    const mine = writes.filter((write) => write.block === block.id);
    if (mine.length === 0) continue;
    const cells = mine.filter((write) => write.field.kind === 'cell');
    for (const write of mine) {
      if (write.field.kind === 'text') edits.push({ edit: 'setText', block: block.id, markdown: write.to });
      if (write.field.kind === 'alt') edits.push({ edit: 'patchBlock', block: block.id, data: { alt: write.to } });
    }
    if (cells.length > 0) {
      const rows = structuredClone(block.data.rows as Row[]);
      for (const write of cells) {
        const { field } = write;
        if (field.kind !== 'cell') continue;
        const cell = rows.find((row) => row.id === field.row)?.cells?.[field.column];
        if (cell) cell.markdown = write.to;
      }
      edits.push({ edit: 'patchBlock', block: block.id, data: { rows } });
    }
  }
  return edits;
}

type Build = (blocks: readonly BlockJson[]) => Written[];

async function send(pages: PagesClient, page: string, build: Build, shown?: ShownTarget | null): Promise<Written[]> {
  if (shown?.id === page) {
    await shown.flush();
    const blocks = shown.blocks();
    const writes = build(blocks);
    if (writes.length === 0) return writes;
    const edits = editsFor(blocks, writes);
    await shown.send(edits);
    edits.forEach((edit) => shown.show(edit));
    return writes;
  }
  const open = await pages.open(page, { viewport: null });
  try {
    const writes = build(open.initial.blocks);
    if (writes.length > 0) await open.send({ edits: editsFor(open.initial.blocks, writes) });
    return writes;
  } finally {
    await open.close();
  }
}

interface Group {
  block: string;
  field: Field;
  matches: Match[];
}

function groups(matches: readonly Match[]): Group[] {
  const out: Group[] = [];
  for (const match of matches) {
    const found = out.find((group) => group.block === match.block && sameField(group.field, match.field));
    if (found) found.matches.push(match);
    else out.push({ block: match.block, field: match.field, matches: [match] });
  }
  return out;
}

/** Replaces the matches in their pages. A page that can't be written is skipped, and the others go on. */
export async function applyReplace(
  pages: PagesClient,
  matches: readonly Match[],
  replacement: string,
  shown?: ShownTarget | null,
): Promise<Replaced> {
  const result: Replaced = { written: [], pages: 0, matches: 0, skipped: 0 };
  const byPage = new Map<string, Match[]>();
  for (const match of matches) byPage.set(match.page, [...(byPage.get(match.page) ?? []), match]);
  for (const [page, list] of byPage) {
    try {
      const build: Build = (blocks) => {
        const writes: Written[] = [];
        for (const group of groups(list)) {
          const block = blocks.find((candidate) => candidate.id === group.block);
          const current = block ? fieldText(block, group.field) : null;
          const fits = current === null ? [] : group.matches.filter((m) => current.slice(m.start, m.end) === m.found);
          result.skipped += group.matches.length - fits.length;
          if (current === null || fits.length === 0) continue;
          result.matches += fits.length;
          const to = replaceAt(current, fits, replacement);
          writes.push({ page, block: group.block, field: group.field, from: current, to });
        }
        return writes;
      };
      const done = await send(pages, page, build, shown);
      if (done.length > 0) result.pages += 1;
      result.written.push(...done);
    } catch {
      result.skipped += list.length;
    }
  }
  return result;
}

/** Puts back every field the replace wrote, unless it has been edited since. Returns how many it restored. */
export async function undoReplace(
  pages: PagesClient,
  written: readonly Written[],
  shown?: ShownTarget | null,
): Promise<number> {
  let restored = 0;
  const byPage = new Map<string, Written[]>();
  for (const write of written) byPage.set(write.page, [...(byPage.get(write.page) ?? []), write]);
  for (const [page, list] of byPage) {
    try {
      const build: Build = (blocks) =>
        list
          .filter((write) => {
            const block = blocks.find((candidate) => candidate.id === write.block);
            return block !== undefined && fieldText(block, write.field) === write.to;
          })
          .map((write) => ({ ...write, from: write.to, to: write.from }));
      const done = await send(pages, page, build, shown);
      restored += done.length;
    } catch {
      // This page keeps what the replace wrote.
    }
  }
  return restored;
}
