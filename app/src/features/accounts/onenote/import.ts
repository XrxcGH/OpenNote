// Bringing OneNote notebooks in through Microsoft Graph. Each notebook becomes a notebook, each section (and each section
// group's sections) a section, and each page a page with its text, headings, lists, tables, and pictures. What can't
// come over is listed in an Import report page: ink, attachments, and anything simplified. Doing it again adds the pages
// that are new and leaves the ones already here alone, because they may hold the person's own writing. State is kept for
// each Microsoft account, so switching accounts never mixes one person's notebooks with another's.

import { newId } from '../../../editor/ids';
import { encodeRecords } from '../../../core/ink/codec';
import { recordFromStroke } from '../../ink';
import type { InkStroke } from '../../ink';
import type { PageExtrasClient, PagesClient } from '../../../platform/types';
import type { Edit } from '../../../services/pages/types';
import type { NodeId, NotesService } from '../../../services/notes/types';
import type { PageLevel } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import { cleanTitle, createPage, replaceMarkdown } from '../notebook';
import { loadState, saveState } from '../state';
import { convertPage } from './html';
import type { PageBlock } from './html';
import type { InkSpec } from './inkml';
import { fetchPicture, listPages, listSections, pageHtml } from './graph';
import type { GraphNotebook } from './graph';

interface PageState {
  node: string;
  modified: string;
}

interface NotebookState {
  node: string;
  sections: Record<string, { node: string; pages: Record<string, PageState> }>;
  report?: { page: string; blocks: string[] };
}

interface AccountState {
  notebooks: Record<string, NotebookState>;
}

export interface ImportDeps {
  client: ConnectorsClient;
  host: AccountsHost;
  notes: NotesService;
  pages: PagesClient;
  /** Attaches files to a page. Without it, attachments are listed in the report instead. */
  extras?: Pick<PageExtrasClient, 'attachBytes'> | null;
  /** The account the notebooks are read from, which keeps the state apart. */
  account: string;
  progress?(done: number, total: number): void;
}

export interface NotebookReport {
  notebook: string;
  node: NodeId;
  sections: number;
  pages: number;
  /** Pages that were already here and were left as they are. */
  kept: number;
  /** Pages that changed in OneNote after they were brought in. */
  changedInOneNote: string[];
  tables: string[];
  attachments: { page: string; name: string }[];
  /** Attached files that came over as files on their pages. */
  attached: number;
  /** Strokes of ink that came over. */
  ink: number;
  pictures: { fetched: number; failed: { page: string; why: string }[] };
  failedPages: { page: string; why: string }[];
}

/** A state file name for an account: lowercase letters, digits, and dashes. */
export function stateName(account: string): string {
  const slug = account
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `onenote.${slug || 'account'}`;
}

const WIDEST = 640;

interface InkLayer {
  id: string | null;
}
type OpenPage = Awaited<ReturnType<PagesClient['open']>>;

const STROKES_PER_BATCH = 400;
const MAX_ATTACHMENT = 200 * 1024 * 1024;

/** Draws strokes on the page's ink layer, made with the first. Answers the block to put the next one after. */
async function writeInk(
  open: OpenPage,
  layer: InkLayer,
  specs: readonly InkSpec[],
  after: string | undefined,
  report: NotebookReport,
): Promise<string | undefined> {
  const now = Date.now();
  for (let from = 0; from < specs.length; from += STROKES_PER_BATCH) {
    const edits: Edit[] = [];
    if (!layer.id) {
      layer.id = newId();
      edits.push({
        edit: 'insertBlock',
        block: { id: layer.id, type: 'ink', frame: { x: 0, y: 0 }, data: { role: 'layer' } },
      });
    }
    const block = layer.id;
    const strokes: InkStroke[] = specs.slice(from, from + STROKES_PER_BATCH).map((spec) => ({
      id: newId(),
      tool: spec.highlighter ? 'highlighter' : 'pen',
      width: spec.width,
      startTime: now,
      startUnknown: true,
      points: spec.points,
      block,
      slot: 0,
      color: spec.color,
    }));
    await open.send({
      edits,
      strokes: encodeRecords(strokes.map((stroke) => ({ kind: 'stroke' as const, stroke: recordFromStroke(stroke) }))),
    });
    report.ink += strokes.length;
  }
  return after;
}

/** Fetches an attached file and puts it on the page as a file block. A file that can't come over is listed. */
async function writeAttachment(
  deps: ImportDeps,
  open: OpenPage,
  pageId: string,
  title: string,
  block: Extract<PageBlock, { kind: 'attachment' }>,
  after: string | undefined,
  report: NotebookReport,
): Promise<string | undefined> {
  const lost = () => {
    report.attachments.push({ page: title, name: block.name });
    return after;
  };
  if (!deps.extras) return lost();
  try {
    const file = await fetchPicture(
      deps.host,
      block.src,
      `onenote-${newId()}.bin`,
      block.mime || 'application/octet-stream',
    );
    if (file.bytes.length > MAX_ATTACHMENT) return lost();
    const asset = await deps.extras.attachBytes(
      pageId,
      file.bytes.slice().buffer,
      block.name || t('accounts.onenote.untitledFile'),
      block.mime || file.mime,
    );
    const id = newId();
    await open.send({
      edits: [
        { edit: 'addAsset', asset: asset.id },
        {
          edit: 'insertBlock',
          block: { id, type: 'file', data: { asset: asset.id } },
          ...(after ? { after } : {}),
        },
      ],
    });
    report.attached += 1;
    return id;
  } catch {
    return lost();
  }
}

/** Writes a converted page onto a page: text blocks, then each picture fetched, in order. */
async function writeBlocks(
  deps: ImportDeps,
  pageId: string,
  title: string,
  blocks: readonly PageBlock[],
  report: NotebookReport,
  // checks-disable-next-line modifiability: nested callbacks that walk one structure; flatten them when this changes
): Promise<void> {
  const open = await deps.pages.open(pageId, { viewport: null });
  const layer: InkLayer = { id: null };
  try {
    let after: string | undefined;
    for (const block of blocks) {
      const id = newId();
      if (block.kind === 'text') {
        await open.send({
          edits: [
            {
              edit: 'insertBlock',
              block: { id, type: 'text', data: { markdown: block.markdown } },
              ...(after ? { after } : {}),
            },
          ],
        });
        after = id;
        continue;
      }
      if (block.kind === 'ink') {
        after = await writeInk(open, layer, block.strokes, after, report);
        continue;
      }
      if (block.kind === 'attachment') {
        after = await writeAttachment(deps, open, pageId, title, block, after, report);
        continue;
      }
      try {
        const picture = await fetchPicture(deps.host, block.src, `onenote-${id}.img`);
        const asset = await open.importImage({
          kind: 'bytes',
          bytes: picture.bytes.slice().buffer,
          name: `${title || 'picture'}.${picture.mime.split('/')[1] ?? 'png'}`,
          mime: picture.mime,
        });
        await open.send({
          edits: [
            { edit: 'addAsset', asset: asset.id },
            {
              edit: 'insertBlock',
              block: {
                id,
                type: 'image',
                frame: { w: Math.min(block.width ?? WIDEST, WIDEST) },
                data: { asset: asset.id, ...(block.alt ? { alt: block.alt } : {}) },
              },
              ...(after ? { after } : {}),
            },
          ],
        });
        after = id;
        report.pictures.fetched += 1;
      } catch {
        report.pictures.failed.push({ page: title, why: t('accounts.onenote.report.pictureWhy') });
      }
    }
    await open.saveNow();
  } finally {
    await open.close();
  }
}

/** The text of the Import report page. */
export function reportMarkdown(reports: readonly NotebookReport[]): string[] {
  const out: string[] = [t('accounts.onenote.report.intro', { date: new Date().toLocaleDateString() })];
  for (const one of reports) {
    out.push(`## ${one.notebook}`);
    out.push(t('accounts.onenote.report.counts', { sections: one.sections, pages: one.pages, kept: one.kept }));
    if (one.failedPages.length > 0) {
      out.push(
        t('accounts.onenote.report.failedPages'),
        one.failedPages.map((page) => `- ${page.page}: ${page.why}`).join('\n'),
      );
    }
    if (one.changedInOneNote.length > 0) {
      out.push(t('accounts.onenote.report.changed'), one.changedInOneNote.map((page) => `- ${page}`).join('\n'));
    }
    if (one.tables.length > 0) {
      out.push(t('accounts.onenote.report.tables'), one.tables.map((page) => `- ${page}`).join('\n'));
    }
    if (one.attached > 0) out.push(t('accounts.onenote.report.attached', { count: one.attached }));
    if (one.ink > 0) out.push(t('accounts.onenote.report.inked', { count: one.ink }));
    if (one.attachments.length > 0) {
      out.push(
        t('accounts.onenote.report.attachments'),
        one.attachments.map((file) => `- ${file.name} (${file.page})`).join('\n'),
      );
    }
    if (one.pictures.failed.length > 0) {
      out.push(
        t('accounts.onenote.report.pictures', { count: one.pictures.failed.length }),
        one.pictures.failed.map((file) => `- ${file.page}`).join('\n'),
      );
    }
  }
  return out;
}

/** Brings the notebooks in. Answers one report for each. */
export async function importNotebooks(deps: ImportDeps, chosen: readonly GraphNotebook[]): Promise<NotebookReport[]> {
  const name = stateName(deps.account);
  const state = await loadState<AccountState>(name, { notebooks: {} }, deps.host);
  const reports: NotebookReport[] = [];
  let done = 0;
  let total = 0;
  for (const notebook of chosen) {
    const sections = await listSections(deps.client, notebook.id);
    const listed = await Promise.all(
      sections.map(async (section) => ({ section, pages: await listPages(deps.client, section.id) })),
    );
    total += listed.reduce((sum, one) => sum + one.pages.length, 0);
    let known: NotebookState | undefined = state.notebooks[notebook.id];
    if (known && !(await deps.notes.get(known.node as NodeId))) known = undefined;
    if (!known) {
      const taken = (await deps.notes.listNotebooks()).some((one) => one.title === cleanTitle(notebook.name, ''));
      const title = taken ? `${notebook.name} (${deps.account})` : notebook.name;
      const made = await deps.notes.create({
        kind: 'notebook',
        placement: { parentId: null, beforeId: null },
        title: cleanTitle(title, t('accounts.onenote.untitledNotebook')),
      });
      known = { node: made.id, sections: {} };
    }
    state.notebooks[notebook.id] = known;
    const report: NotebookReport = {
      notebook: notebook.name,
      node: known.node as NodeId,
      sections: 0,
      pages: 0,
      kept: 0,
      changedInOneNote: [],
      tables: [],
      attachments: [],
      attached: 0,
      ink: 0,
      pictures: { fetched: 0, failed: [] },
      failedPages: [],
    };
    for (const { section, pages } of listed) {
      let sectionState: NotebookState['sections'][string] | undefined = known.sections[section.id];
      if (sectionState && !(await deps.notes.get(sectionState.node as NodeId))) sectionState = undefined;
      if (!sectionState) {
        const made = await deps.notes.create({
          kind: 'section',
          placement: { parentId: known.node as NodeId, beforeId: null },
          title: cleanTitle(section.name, t('accounts.onenote.untitledSection')),
        });
        sectionState = { node: made.id, pages: {} };
        known.sections[section.id] = sectionState;
      }
      report.sections += 1;
      for (const page of pages) {
        done += 1;
        deps.progress?.(done, total);
        const earlier = sectionState.pages[page.id];
        if (earlier && (await deps.notes.get(earlier.node as NodeId))) {
          report.kept += 1;
          if (page.modified && earlier.modified && page.modified > earlier.modified) {
            report.changedInOneNote.push(page.title || t('accounts.onenote.untitledPage'));
          }
          continue;
        }
        try {
          const converted = convertPage(await pageHtml(deps.client, page.id));
          const title = page.title || converted.title || t('accounts.onenote.untitledPage');
          const node = await createPage(deps.notes, deps.pages, sectionState.node as NodeId, title, []);
          if (page.level > 0) await deps.notes.setPageLevel([node.id], page.level as PageLevel);
          await writeBlocks(deps, node.id, title, converted.blocks, report);
          sectionState.pages[page.id] = { node: node.id, modified: page.modified };
          report.pages += 1;
          if (converted.losses.tables > 0) report.tables.push(title);
          for (const file of converted.losses.attachments) report.attachments.push({ page: title, name: file });
        } catch (error) {
          report.failedPages.push({
            page: page.title || t('accounts.onenote.untitledPage'),
            why: error instanceof Error && error.message ? error.message : t('accounts.onenote.report.pageWhy'),
          });
        }
        await saveState(name, state, deps.host);
      }
    }
    reports.push(report);
  }
  await writeReport(deps, state, chosen, reports);
  await saveState(name, state, deps.host);
  return reports;
}

/** Puts the Import report on a page of the first notebook, replacing the report of the last time. */
async function writeReport(
  deps: ImportDeps,
  state: AccountState,
  chosen: readonly GraphNotebook[],
  reports: readonly NotebookReport[],
): Promise<void> {
  const first = chosen[0] ? state.notebooks[chosen[0].id] : undefined;
  if (!first) return;
  const text = reportMarkdown(reports);
  const earlier = first.report ? await deps.notes.get(first.report.page as NodeId) : null;
  if (earlier && first.report) {
    first.report.blocks = await replaceMarkdown(deps.pages, first.report.page, first.report.blocks, text);
    return;
  }
  const sectionTitle = t('accounts.onenote.report.section');
  const existing = (await deps.notes.listChildren(first.node as NodeId)).find(
    (node) => node.kind === 'section' && node.title === sectionTitle,
  );
  const section =
    existing ??
    (await deps.notes.create({
      kind: 'section',
      placement: { parentId: first.node as NodeId, beforeId: null },
      title: sectionTitle,
    }));
  const page = await createPage(deps.notes, deps.pages, section.id, t('accounts.onenote.report.title'), []);
  first.report = { page: page.id, blocks: await replaceMarkdown(deps.pages, page.id, [], text) };
}
