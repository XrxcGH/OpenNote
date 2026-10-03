// Paste extras (Phase 4 ARCHITECTURE.md section 15.7, FEATURES.md "Paste extras"): a web address pasted over
// selected words links them, a source link follows text from a browser, and broken PDF lines are joined. Each is
// its own undo step, so one Ctrl+Z undoes it and leaves the paste.
import type { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { plainTextPieces } from '../../../editor/markdown/paste';
import { updateSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import type { MountedPage } from '../mount';

const LINKABLE = /^(?:https?:\/\/[^\s/$.?#][^\s]*|mailto:[^\s@]+@[^\s@]+)$/i;

/** Links the selected words to a lone web or mail address that was pasted over them. */
export function linkOverSelection(editor: Editor, text: string): boolean {
  const href = text.trim();
  const { selection } = editor.state;
  const link = editor.schema.marks.link;
  if (!link || selection.empty || !LINKABLE.test(href)) return false;
  editor.view.dispatch(editor.state.tr.addMark(selection.from, selection.to, link.create({ href })));
  return true;
}

/** Replaces the pasted text with its broken lines joined, as a second undo step, with an Undo toast. */
export async function joinPdfLines(
  mounted: MountedPage,
  editor: Editor,
  range: { from: number; to: number },
  joined: string,
): Promise<void> {
  const [piece] = plainTextPieces(joined);
  if (piece?.kind !== 'text') return;
  // The raw paste goes first, as its own step.
  await mounted.sync.flushAll('command');
  const content = editor.schema.nodeFromJSON(piece.doc.toJSON()).content;
  const to = Math.min(range.to, editor.state.doc.content.size);
  editor.view.dispatch(editor.state.tr.replaceRange(range.from, to, Slice.maxOpen(content)));
  await mounted.sync.flushAll('command');
  showToast({
    message: t('paste.joined'),
    action: { label: t('paste.undo'), run: () => mounted.sync.undo() },
  });
}

let askedThisSession = false;

/** The host a source link names, without "www.". */
export function sourceHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function insertSourceLink(editor: Editor, url: string, host: string): void {
  const { state } = editor;
  const { paragraph } = state.schema.nodes;
  const link = state.schema.marks.link;
  if (!paragraph || !link) return;
  const $to = state.doc.resolve(state.selection.to);
  const at = $to.depth > 0 ? $to.after(1) : state.doc.content.size;
  const label = t('paste.source', { host });
  const node = paragraph.create(null, state.schema.text(label, [link.create({ href: url })]));
  editor.view.dispatch(state.tr.insert(at, node));
}

/** "Always" on the prompt: the setting changes, and this paste gets its link as its own step. */
async function answerAlways(mounted: MountedPage, editor: Editor, url: string, host: string): Promise<void> {
  await updateSettings({ editing: { paste: { sourceLink: 'always' } } });
  if (editor.isDestroyed) return;
  await mounted.sync.flushAll('command');
  insertSourceLink(editor, url, host);
  await mounted.sync.flushAll('command');
}

/**
 * Adds "Source: en.wikipedia.org" below text from a browser, linking to the page. The page's title is never fetched.
 * The first web paste asks first; until the person answers, no link is added.
 */
export async function addSourceLink(
  mounted: MountedPage,
  editor: Editor,
  url: string,
  mode: 'ask' | 'always' | 'never',
): Promise<void> {
  const host = sourceHost(url);
  if (!host || mode === 'never') return;
  if (mode === 'ask') {
    if (askedThisSession) return;
    askedThisSession = true;
    showToast({
      id: 'paste.sourcePrompt',
      message: t('paste.sourcePrompt.message'),
      action: { label: t('paste.sourcePrompt.always'), run: () => answerAlways(mounted, editor, url, host) },
    });
    return;
  }
  await mounted.sync.flushAll('command');
  insertSourceLink(editor, url, host);
  await mounted.sync.flushAll('command');
  announce(t('paste.source', { host }));
}

/** For tests: the prompt shows again. */
export function resetSourcePrompt(): void {
  askedThisSession = false;
}
