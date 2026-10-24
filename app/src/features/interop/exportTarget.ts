// What an export can cover, and the tree the host needs for it. The host reads page files, but the structure and
// the titles come from the tree the person sees, so the interface sends them.

import type { ExportRequest, ExportScope } from '../../platform/interop';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes/types';
import { t } from '../../strings/t';

export interface ExportChoice {
  scope: ExportScope;
  node: NodeSummary;
}

export interface ExportTarget {
  notebook: NodeSummary;
  /** The page, the section, and the notebook that hold the node the export started from, innermost first. */
  choices: ExportChoice[];
  /** The scope of the node the export started from. */
  initial: ExportScope;
}

/** Finds what the node sits in. Null when the node, or its notebook, is gone. */
export async function resolveTarget(notes: NotesService, id: NodeId): Promise<ExportTarget | null> {
  const start = await notes.get(id);
  if (!start) return null;
  let page: NodeSummary | null = null;
  let section: NodeSummary | null = null;
  let notebook: NodeSummary | null = null;
  let node: NodeSummary | null = start;
  while (node) {
    if (node.kind === 'page') page ??= node;
    else if (node.kind === 'section') section ??= node;
    else if (node.kind === 'notebook') notebook = node;
    node = node.parentId ? await notes.get(node.parentId) : null;
  }
  if (!notebook) return null;
  const choices: ExportChoice[] = [];
  if (page) choices.push({ scope: 'page', node: page });
  if (section) choices.push({ scope: 'section', node: section });
  choices.push({ scope: 'notebook', node: notebook });
  const initial = start.kind === 'page' ? 'page' : start.kind === 'section' ? 'section' : 'notebook';
  return { notebook, choices, initial };
}

const titleOf = (node: NodeSummary, fallback: string) => (node.title.trim() === '' ? fallback : node.title);

async function pagesOf(notes: NotesService, section: NodeSummary) {
  const children = await notes.listChildren(section.id);
  return children
    .filter((child) => child.kind === 'page')
    .map((child) => ({ ui: child.id, title: titleOf(child, t('tree.untitled.page')), level: child.pageLevel }));
}

/** Sections of a notebook or section group, in order. Groups flatten into the section's title. */
async function sectionsOf(
  notes: NotesService,
  parent: NodeSummary,
  prefix: string,
): Promise<ExportRequest['sections']> {
  const found: ExportRequest['sections'] = [];
  for (const child of await notes.listChildren(parent.id)) {
    if (child.kind === 'section') {
      found.push({
        title: `${prefix}${titleOf(child, t('tree.untitled.section'))}`,
        pages: await pagesOf(notes, child),
      });
    } else if (child.kind === 'sectionGroup') {
      const group = `${prefix}${titleOf(child, t('tree.untitled.sectionGroup'))} - `;
      found.push(...(await sectionsOf(notes, child, group)));
    }
  }
  return found;
}

/** The part of an export request that depends on what is exported. */
export async function collectRequest(
  notes: NotesService,
  target: ExportTarget,
  scope: ExportScope,
): Promise<Pick<ExportRequest, 'scope' | 'title' | 'sections'>> {
  const notebookTitle = titleOf(target.notebook, t('tree.untitled.notebook'));
  const section = target.choices.find((choice) => choice.scope === 'section')?.node;
  if (scope === 'notebook') {
    return { scope, title: notebookTitle, sections: await sectionsOf(notes, target.notebook, '') };
  }
  if (scope === 'section' && section) {
    const title = titleOf(section, t('tree.untitled.section'));
    return { scope, title: notebookTitle, sections: [{ title, pages: await pagesOf(notes, section) }] };
  }
  const node = target.choices.find((choice) => choice.scope === 'page')?.node;
  const pages = node ? [{ ui: node.id, title: titleOf(node, t('tree.untitled.page')), level: 0 }] : [];
  const title = section ? titleOf(section, t('tree.untitled.section')) : notebookTitle;
  return { scope: 'page', title: notebookTitle, sections: [{ title, pages }] };
}

export function pageCount(request: Pick<ExportRequest, 'sections'>): number {
  return request.sections.reduce((total, section) => total + section.pages.length, 0);
}
