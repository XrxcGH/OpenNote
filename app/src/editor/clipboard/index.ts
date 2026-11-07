// The clipboard extension (ADR 0084), registered through editorExtensions behind text.pasteFidelity. Copy and cut
// write HTML with inline CSS (serializer.ts), plain text, and Markdown (as `text/markdown`, for apps that read it).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createMarkdownCache, serializeTextBlock } from '../markdown';
import { editorExtensions } from '../extensions/kit';
import { clipboardSerializer } from './serializer';

export { clipboardSerializer, mergeSpans } from './serializer';
export { PARA_DATA } from './paraData';

const key = new PluginKey('opennoteClipboard');

/** The selection as Markdown, or null when it is empty or not whole blocks (a cell, a partial parse). */
export function selectionMarkdown(view: EditorView): string | null {
  const { selection, schema } = view.state;
  if (selection.empty) return null;
  try {
    const doc = schema.topNodeType.createAndFill(null, selection.content().content);
    return doc ? serializeTextBlock(doc, createMarkdownCache()) : null;
  } catch {
    return null;
  }
}

/** Adds `text/markdown` after the editor's own copy handler has written the other formats. */
function addMarkdown(view: EditorView, event: ClipboardEvent): void {
  const data = event.clipboardData;
  const markdown = data ? selectionMarkdown(view) : null;
  if (data && markdown !== null && data.getData('text/html') !== '') data.setData('text/markdown', markdown);
}

export const clipboardExtension = Extension.create({
  name: 'opennoteClipboard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: { clipboardSerializer: clipboardSerializer(this.editor.schema) },
        view: (view) => {
          const copy = (event: Event) => addMarkdown(view, event as ClipboardEvent);
          // After ProseMirror's own listener on the same element, which writes the other formats first.
          view.dom.addEventListener('copy', copy);
          view.dom.addEventListener('cut', copy);
          return {
            destroy: () => {
              view.dom.removeEventListener('copy', copy);
              view.dom.removeEventListener('cut', copy);
            },
          };
        },
      }),
    ];
  },
});

if (!editorExtensions.get('text.clipboard')) {
  editorExtensions.register({
    id: 'text.clipboard',
    order: 410,
    flag: 'text.pasteFidelity',
    kinds: ['text'],
    create: () => clipboardExtension,
  });
}
