// "Share to OpenNote" (flag integrations.shareTarget; docs/help/import-and-export.md). The shell saves each share
// to its inbox (app/src-tauri/src/share); this takes them and adds each one to the open page through the page's own
// paste, so text, links, pictures, and files land the way a paste of them would. With no page open, or one that
// can't change, a share becomes a new page in Quick notes instead.

/** A file in a share, as the shell sends it. */
export interface ShareFile {
  name: string;
  mime: string;
  /** Base64. */
  data: string;
}

/** A share, as `share_take` returns it (ShareBlocks in share/mod.rs). */
export interface ShareBlocks {
  title: string;
  text: string;
  link: string | null;
  markdown: string;
  files: ShareFile[];
  skipped: string[];
}

/** Bytes from base64. */
export function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at);
  return bytes;
}

/** The text a paste carries: the link, then the text when it is more than the link again. */
export function shareText(share: ShareBlocks): string {
  const text = share.text.trim();
  return [share.link, text && text !== share.link ? text : null].filter(Boolean).join('\n\n');
}

/**
 * What a paste of the share carries: plain text, the link as a URI list (only web links), and each file. With
 * `filesOnly`, just the files, for a quick note that already has the text.
 */
export function shareTransfer(share: ShareBlocks, filesOnly = false, make = () => new DataTransfer()): DataTransfer {
  const data = make();
  if (!filesOnly) {
    const text = shareText(share);
    if (text) data.setData('text/plain', text);
    if (share.link && /^https?:\/\//i.test(share.link)) data.setData('text/uri-list', share.link);
  }
  for (const file of share.files) {
    data.items.add(new File([fromBase64(file.data)], file.name, { type: file.mime }));
  }
  return data;
}

/** The body of a quick note: the Markdown, without its first line when that line is the title. */
export function quickNoteBody(share: ShareBlocks): string {
  const lines = share.markdown.split('\n');
  return (lines[0]?.trim() === share.title ? lines.slice(1) : lines).join('\n').trim();
}

export interface ShareDeps {
  /** Where a paste goes in the open page, or null when no page that can change is open. */
  pasteTarget(): EventTarget | null;
  /** Makes a page in Quick notes; resolves with its ID, or null when there's no notebook. */
  quickNote(title: string, body: string): Promise<string | null>;
  /** Opens a page and resolves with its paste target once it shows, or null. */
  openForPaste(pageId: string): Promise<EventTarget | null>;
  /** Makes the DataTransfer a paste carries; tests supply a stand-in. */
  transfer?: () => DataTransfer;
}

export type ShareResult = 'page' | 'quickNote' | 'none';

function paste(target: EventTarget, data: DataTransfer): void {
  const init = { bubbles: true, cancelable: true };
  const event =
    typeof ClipboardEvent === 'function'
      ? new ClipboardEvent('paste', { ...init, clipboardData: data })
      : Object.assign(new Event('paste', init), { clipboardData: data });
  target.dispatchEvent(event);
}

/** Adds one share where it belongs. */
export async function addShare(share: ShareBlocks, deps: ShareDeps): Promise<ShareResult> {
  const target = deps.pasteTarget();
  if (target) {
    paste(target, shareTransfer(share, false, deps.transfer));
    return 'page';
  }
  const page = await deps.quickNote(share.title, quickNoteBody(share));
  if (!page) return 'none';
  if (share.files.length) {
    const opened = await deps.openForPaste(page);
    if (opened) paste(opened, shareTransfer(share, true, deps.transfer));
  }
  return 'quickNote';
}
