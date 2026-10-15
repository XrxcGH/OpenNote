// Running the page tools over a choice of pages (A2-20): the shown page, a range of the section's pages that hold
// PDF pages or slides, or all of them. The shown page is changed through its open view, so the change shows at
// once and joins its undo history. Other pages are opened, changed in one step each, and closed.
import { getLocation } from '../../app/location';
import type { Platform } from '../../platform/types';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';
import { t } from '../../strings/t';
import { showToast } from '../../ui';
import { isPagePicture } from './model';
import { handoutEdits, noteSpaceEdits, sheetsOf } from './noteSpace';
import type { HandoutPicture, Paper, PerSheet, Side } from './noteSpace';
import { closedTarget } from './target';
import type { EditTarget } from './target';

export type Scope = { kind: 'page' } | { kind: 'range'; from: number; to: number } | { kind: 'all' };

export interface ToolDeps {
  platform: Platform;
  notes: NotesService;
  /** The shown page, when one is shown. */
  shown(): Promise<EditTarget | null>;
}

/** The pages a scope covers, from the section's pages in order. A range counts from 1 and includes both ends. */
export function pagesInScope<T>(pages: readonly T[], scope: Scope, current: number): T[] {
  if (scope.kind === 'all') return [...pages];
  if (scope.kind === 'page') return current >= 0 && current < pages.length ? [pages[current]] : [];
  const from = Math.max(1, Math.min(scope.from, scope.to));
  const to = Math.min(pages.length, Math.max(scope.from, scope.to));
  return pages.slice(from - 1, to);
}

async function sectionPages(notes: NotesService): Promise<{ pages: NodeSummary[]; section: NodeId | null }> {
  const here = getLocation();
  if (here.view !== 'workspace' || !here.sectionId) return { pages: [], section: null };
  const children = await notes.listChildren(here.sectionId);
  return { pages: children.filter((node) => node.kind === 'page'), section: here.sectionId };
}

/** Runs `change` on each page in scope, through the shown view for the shown page. Resolves how many changed. */
async function eachPage(
  deps: ToolDeps,
  scope: Scope,
  change: (target: EditTarget) => Promise<boolean>,
): Promise<number> {
  const shown = await deps.shown();
  const { pages } = await sectionPages(deps.notes);
  const current = shown ? pages.findIndex((node) => node.id === shown.page.id) : -1;
  const targets = scope.kind === 'page' && shown ? [{ id: shown.page.id }] : pagesInScope(pages, scope, current);
  let changed = 0;
  for (const node of targets) {
    if (shown && node.id === shown.page.id) {
      if (await change(shown)) changed += 1;
      continue;
    }
    const page = await deps.platform.pages.open(node.id as never, { viewport: null });
    try {
      if (await change(closedTarget(page))) changed += 1;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return changed;
}

/** Adds note space beside the PDF pages and slides of the pages in scope. */
export async function addNoteSpace(deps: ToolDeps, scope: Scope, side: Side, paper: Paper): Promise<number> {
  const changed = await eachPage(deps, scope, async (target) => {
    const edits = await noteSpaceEdits(target, side, paper);
    if (edits.length === 0) return false;
    await target.send(edits);
    return true;
  });
  showToast({ message: changed > 0 ? t('pdf.noteSpace.done', { count: changed }) : t('pdf.noteSpace.none') });
  return changed;
}

async function picturesOf(target: EditTarget): Promise<HandoutPicture[]> {
  const { page } = target;
  const pictures: HandoutPicture[] = [];
  for (const block of target.blocks().filter(isPagePicture)) {
    const asset = typeof block.data.asset === 'string' ? block.data.asset : null;
    const info = asset ? page.initial.assets[asset] : undefined;
    if (!asset) continue;
    const response = await fetch(page.assetUrl(asset)).catch(() => null);
    if (!response?.ok) continue;
    const width = block.frame?.w ?? info?.width ?? 4;
    const height = block.frame?.h ?? info?.height ?? 3;
    pictures.push({
      bytes: await response.arrayBuffer(),
      mime: info?.mime ?? response.headers.get('content-type') ?? 'image/png',
      name: info?.name ?? 'page.png',
      alt: typeof block.data.alt === 'string' ? block.data.alt : '',
      ratio: width / height,
    });
  }
  return pictures;
}

/** Makes handout pages at the end of the section: the pictures of the pages in scope, `perSheet` to a page. */
export async function makeHandouts(deps: ToolDeps, scope: Scope, perSheet: PerSheet, paper: Paper): Promise<number> {
  const { section } = await sectionPages(deps.notes);
  if (!section) {
    showToast({ message: t('pdf.needSection') });
    return 0;
  }
  const pictures: HandoutPicture[] = [];
  await eachPage(deps, scope, async (target) => {
    pictures.push(...(await picturesOf(target)));
    return false;
  });
  if (pictures.length === 0) {
    showToast({ message: t('pdf.handouts.none') });
    return 0;
  }
  const sheets = sheetsOf(pictures, perSheet);
  for (const [index, sheet] of sheets.entries()) {
    const node = await deps.notes.create({
      kind: 'page',
      placement: { parentId: section, beforeId: null },
      title: t('pdf.handouts.pageTitle', { number: index + 1 }),
    });
    const page = await deps.platform.pages.open(node.id as never, { viewport: null });
    try {
      await closedTarget(page).send(await handoutEdits(page, sheet, perSheet, paper));
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  showToast({ message: t('pdf.handouts.done', { count: sheets.length }) });
  return sheets.length;
}
