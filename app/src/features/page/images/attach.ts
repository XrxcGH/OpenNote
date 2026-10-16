// Images and the clipboard on a page view (Phase 4 ARCHITECTURE.md sections 12 and 15, owner: WP5). mount.ts calls
// attachPageMedia once a page view exists. Importing this module registers the image block renderer, so it is in
// place before the block layer renders. Paste and drop data is read synchronously in the event, and the pipeline
// loads on first use (and on idle), so the start-up and page chunks stay small. Copy runs synchronously too.
import { commandContext } from '../../../commands/registry';
import { serializeTextBlock } from '../../../editor/markdown';
import type { ClipboardClient } from '../../../platform/types';
import { DOMSerializer } from '@tiptap/pm/model';
import { fileBlockRenderer } from '../blocks/fileBlock';
import { imageBlockRenderer } from '../blocks/imageBlock';
import type { MountedPage } from '../mount';
import { blockRenderers } from '../registries';
import { pageSelection, selectOnPage } from '../seams/selectionStore';
import { writeBlocks } from '../paste/blocks';
import type { PasteRequest } from '../paste/pipeline';
import { shownMedia } from './shown';

if (!blockRenderers.get(imageBlockRenderer.id)) blockRenderers.register(imageBlockRenderer);
if (!blockRenderers.get(fileBlockRenderer.id)) blockRenderers.register(fileBlockRenderer);

/** The shell's clipboard client, when commands are configured (the app and the page harness). */
function clipboardClient(): ClipboardClient | null {
  try {
    return commandContext('test').platform.clipboard;
  } catch {
    return null;
  }
}

const pipeline = () => import('../paste/pipeline');

/** Runs a paste or drop through the pipeline, with the page's flags. */
export function runOnPage(mounted: MountedPage, request: PasteRequest): Promise<void> {
  return pipeline().then(({ runPaste, setPasteFlags }) => {
    setPasteFlags((id) => mounted.host.flag(id));
    return runPaste(mounted, request, clipboardClient());
  });
}

function editingTextField(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element.closest('input, textarea, select')) return true;
  return !!element.closest('[contenteditable="true"]') && !element.closest('.ProseMirror');
}

/** Whether an event's target is inside the page's active editor. */
function inEditor(mounted: MountedPage, target: EventTarget | null): boolean {
  const editor = mounted.pool.active()?.editor;
  return !!editor && target instanceof Node && editor.view.dom.contains(target);
}

/** Whether a paste lands in a table cell or a code block, which handle their own pastes. */
function ownPaste(mounted: MountedPage, target: EventTarget | null): 'code' | 'table' | null {
  if (target instanceof Element && target.closest('td, th')) return 'table';
  const editor = mounted.pool.active()?.editor;
  return editor?.state.selection.$from.parent.type.name === 'codeBlock' ? 'code' : null;
}

/** Copies the editor's selection as HTML and Markdown, so plain text keeps its list markers. */
function copyText(mounted: MountedPage, data: DataTransfer): boolean {
  const editor = mounted.pool.active()?.editor;
  if (!editor || editor.state.selection.empty) return false;
  const slice = editor.state.selection.content();
  const doc = editor.schema.topNodeType.createAndFill(null, slice.content);
  if (!doc) return false;
  const holder = document.createElement('div');
  holder.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
  data.setData('text/html', holder.innerHTML);
  data.setData('text/plain', serializeTextBlock(doc, mounted.cache));
  return true;
}

export function attachPageMedia(mounted: MountedPage, container: HTMLElement, shown: boolean): () => void {
  if (shown) shownMedia.set(mounted);
  let plainNext = false;
  let dragFromHere = false;

  const onKeyDown = (event: KeyboardEvent) => {
    plainNext = event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey) && event.shiftKey;
  };
  const onPaste = (event: ClipboardEvent) => {
    if (event.defaultPrevented || !event.clipboardData || editingTextField(event.target)) return;
    if (!mounted.host.flag('page.editor') || mounted.page.readOnly) return;
    const own = ownPaste(mounted, event.target);
    const data = event.clipboardData;
    if (own === 'table') return;
    const text = data.getData('text/plain') || null;
    if (own === 'code') {
      const editor = mounted.pool.active()?.editor;
      if (!editor || text === null) return;
      event.preventDefault();
      editor.view.dispatch(editor.state.tr.insertText(text.replace(/\r\n?/g, '\n')));
      return;
    }
    const request: PasteRequest = {
      html: data.getData('text/html') || null,
      text,
      files: [...data.files],
      plain: plainNext,
      origin: 'paste',
      intoEditor: inEditor(mounted, event.target),
    };
    plainNext = false;
    event.preventDefault();
    event.stopPropagation();
    void runOnPage(mounted, request);
  };
  const onCopy = (event: ClipboardEvent, cut: boolean) => {
    if (!event.clipboardData || editingTextField(event.target)) return;
    const editor = mounted.pool.active()?.editor;
    if (editor && container.contains(document.activeElement) && editor.view.dom.contains(document.activeElement)) {
      if (!copyText(mounted, event.clipboardData)) return;
      event.preventDefault();
      if (cut && !mounted.page.readOnly) editor.view.dispatch(editor.state.tr.deleteSelection());
      return;
    }
    const blocks = pageSelection.get().blocks;
    if (blocks.length === 0 || !writeBlocks(mounted, blocks, event.clipboardData)) return;
    event.preventDefault();
    if (cut && !mounted.page.readOnly) {
      blocks.forEach((id) => mounted.layer.remove(id));
      selectOnPage({ blocks: [], strokes: [] });
      void mounted.sync.send({ edits: [{ edit: 'deleteBlocks', blocks: [...blocks] }] }).catch(() => undefined);
    }
  };
  const onDragStart = () => {
    dragFromHere = true;
  };
  const onDragEnd = () => {
    dragFromHere = false;
  };
  const external = (event: DragEvent) =>
    !dragFromHere && !!event.dataTransfer && (event.dataTransfer.types.includes('Files') || !mounted.pool.active());
  const onDragOver = (event: DragEvent) => {
    if (!external(event) || mounted.page.readOnly) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: DragEvent) => {
    const data = event.dataTransfer;
    if (!data || dragFromHere || mounted.page.readOnly || !mounted.host.flag('page.editor')) return;
    const files = [...data.files];
    const html = data.getData('text/html') || null;
    const text = data.getData('text/plain') || null;
    // Text dragged inside an editor moves with ProseMirror; other drops go through the pipeline.
    if (files.length === 0 && !data.types.includes('text/html') && !data.types.includes('text/uri-list')) {
      if (mounted.pool.active() && event.target instanceof Element && event.target.closest('.ProseMirror')) return;
    }
    event.preventDefault();
    event.stopPropagation();
    const uri = data
      .getData('text/uri-list')
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith('#'));
    void runOnPage(mounted, {
      html,
      text: text ?? uri ?? null,
      files,
      plain: false,
      origin: 'drop',
      point: { clientX: event.clientX, clientY: event.clientY },
      intoEditor: inEditor(mounted, event.target),
    });
  };
  const keyDown = (event: KeyboardEvent) => onKeyDown(event);
  const paste = (event: ClipboardEvent) => onPaste(event);
  const copy = (event: ClipboardEvent) => onCopy(event, false);
  const cut = (event: ClipboardEvent) => onCopy(event, true);
  container.addEventListener('keydown', keyDown, true);
  container.addEventListener('paste', paste, true);
  container.addEventListener('copy', copy, true);
  container.addEventListener('cut', cut, true);
  container.addEventListener('dragstart', onDragStart, true);
  container.addEventListener('dragend', onDragEnd, true);
  container.addEventListener('dragover', onDragOver, true);
  container.addEventListener('drop', onDrop, true);
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(() => void pipeline()) : null;
  return () => {
    if (idle !== null) cancelIdleCallback(idle);
    container.removeEventListener('keydown', keyDown, true);
    container.removeEventListener('paste', paste, true);
    container.removeEventListener('copy', copy, true);
    container.removeEventListener('cut', cut, true);
    container.removeEventListener('dragstart', onDragStart, true);
    container.removeEventListener('dragend', onDragEnd, true);
    container.removeEventListener('dragover', onDragOver, true);
    container.removeEventListener('drop', onDrop, true);
    if (shownMedia.get() === mounted) shownMedia.set(null);
  };
}
