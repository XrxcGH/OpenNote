// Link titles on paste (FEATURES.md, Link titles on paste). Off by default. When on, pasting a lone web address
// asks the site for its page title in Rust and shows the title as the link text. That request tells the site this
// PC's network address, so Settings says so, the Privacy panel lists it, and it never runs while Work offline is
// on. The replacement is its own undo step: one Ctrl+Z brings back the bare address.
import type { Editor } from '@tiptap/core';
import { commandContext } from '../../../commands/registry';
import { META_COMMAND } from '../../../editor/meta';
import type { PageExtrasClient } from '../../../platform/types';
import { isOffline } from '../../diagnostics';
import type { MountedPage } from '../mount';
import { pageExtrasPrefs } from './prefs';

const BARE_ADDRESS = /^https?:\/\/[^\s<>"]+$/i;

/** Whether the text is one web address and nothing else. */
export function isBareAddress(text: string): boolean {
  return BARE_ADDRESS.test(text.trim()) && URL.canParse(text.trim());
}

/** A title worth showing as link text: not empty, not the address itself. */
export function usableTitle(title: string | null, address: string): string | null {
  const text = (title ?? '').replace(/\s+/g, ' ').trim();
  return text === '' || text === address || text.length > 200 ? null : text;
}

/** The range just before `end` that holds `address`, or null when the text there is something else. */
export function addressRange(editor: Editor, end: number, address: string): { from: number; to: number } | null {
  const from = end - address.length;
  if (from < 1 || end > editor.state.doc.content.size) return null;
  return editor.state.doc.textBetween(from, end, '', '￼') === address ? { from, to: end } : null;
}

/** Replaces the address with its title, as a link to the address, in one step of its own. */
export function showTitle(editor: Editor, end: number, address: string, title: string): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const range = addressRange(editor, end, address);
  if (!range) return false;
  const { schema } = editor;
  const link = schema.marks.link?.create({ href: address });
  if (!link) return false;
  const tr = editor.state.tr.replaceWith(range.from, range.to, schema.text(title, [link]));
  editor.view.dispatch(tr.setMeta(META_COMMAND, true));
  return true;
}

function client(): PageExtrasClient | null {
  try {
    return commandContext('menu').platform.pageExtras;
  } catch {
    return null;
  }
}

/** Waits for the paste pipeline to put the address in the editor, then asks for its title. */
async function titleAfterPaste(mounted: MountedPage, address: string): Promise<void> {
  const native = client();
  if (!native) return;
  for (let tries = 0; tries < 30; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const editor = mounted.pool.active()?.editor;
    const end = editor?.state.selection.to;
    if (!editor || end === undefined || !addressRange(editor, end, address)) continue;
    if (isOffline()) return;
    const title = usableTitle(await native.linkTitle(address).catch(() => null), address);
    // The person may have typed on since; the title only replaces the address where it still stands.
    if (title) showTitle(editor, end, address, title);
    return;
  }
}

export function attachLinkTitles(mounted: MountedPage): () => void {
  if (!mounted.host.flag('page.linkTitles') || mounted.page.readOnly) return () => undefined;
  const container = mounted.viewport.viewport.parentElement;
  if (!container) return () => undefined;
  const onPaste = (event: ClipboardEvent) => {
    if (!pageExtrasPrefs.get().linkTitles || isOffline()) return;
    const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
    if (!isBareAddress(text) || !mounted.pool.active()) return;
    void titleAfterPaste(mounted, text);
  };
  // Capture, after the paste handler on the same element that puts the address in the page.
  container.addEventListener('paste', onPaste, true);
  return () => container.removeEventListener('paste', onPaste, true);
}
