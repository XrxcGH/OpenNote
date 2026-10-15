// Bringing OneNote notebooks in through Microsoft Graph. Each notebook becomes a notebook, each section (and each section
// group's sections) a section, and each page a page with its text, headings, lists, tables, and pictures. What can't
// come over is listed in an Import report page: ink, attachments, and anything simplified. Doing it again adds the pages
// that are new and leaves the ones already here alone, because they may hold the person's own writing. State is kept for
// each Microsoft account, so switching accounts never mixes one person's notebooks with another's.

import { newId } from '../../../editor/ids';
import type { PagesClient } from '../../../platform/types';
import type { NodeId, NotesService } from '../../../services/notes/types';
import type { PageLevel } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';
import { cleanTitle, createPage, replaceMarkdown } from '../notebook';
import { loadState, saveState } from '../state';
import { convertPage } from './html';
import type { PageBlock } from './html';
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

/** Writes a converted page onto a page: text blocks, then each picture fetched, in order. */
async function writeBlocks(
  deps: ImportDeps,
  pageId: string,
  title: string,
  blocks: readonly PageBlock[],
  report: NotebookReport,
): Promise<void> {
  const open = await deps.pages.open(pageId, { viewport: null });
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
  out.push(t('accounts.onenote.report.ink'));
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
