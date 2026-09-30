// The notes of the text spike: one Tiptap editor (a ProseMirror EditorView) per note, each in an absolutely
// positioned container on the world.
import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import type { NoteSpec } from './text-content';

/** A caret rectangle in CSS pixels, relative to the window's viewport. */
export interface CaretRect {
  left: number;
  top: number;
  bottom: number;
  height: number;
}

/** Where to put the caret: at the end of the note, or after the first sentence of its middle paragraph. */
export type CaretPlace = 'end' | 'middle';

/** The position after the first sentence of the paragraph halfway through the document. */
export function middlePosition(doc: ProseMirrorNode): number {
  const paragraphs: { pos: number; node: ProseMirrorNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' && node.textContent.length > 80) paragraphs.push({ pos, node });
    return node.type.name !== 'paragraph';
  });
  const middle = paragraphs[Math.floor(paragraphs.length / 2)];
  if (!middle) return doc.content.size - 1;
  const firstStop = middle.node.textContent.indexOf('. ');
  return middle.pos + 1 + (firstStop < 0 ? 0 : firstStop + 2);
}

export class Notes {
  private readonly editors: (Editor | null)[];
  private readonly containers: HTMLElement[];
  /** Called with every editor transaction, for the key timer. */
  onTransaction: ((docChanged: boolean) => void) | null = null;
  /** Milliseconds each editor took to create, by note index. */
  readonly createMs: number[];

  constructor(
    private readonly specs: NoteSpec[],
    world: HTMLElement,
  ) {
    this.containers = specs.map((spec) => {
      const container = document.createElement('div');
      container.className = 'note';
      container.dataset.name = spec.name;
      Object.assign(container.style, { left: `${spec.x}px`, top: `${spec.y}px`, width: `${spec.width}px` });
      world.append(container);
      return container;
    });
    this.editors = specs.map(() => null);
    this.createMs = specs.map(() => 0);
  }

  get count(): number {
    return this.editors.filter(Boolean).length;
  }

  editor(index: number): Editor {
    const editor = this.editors[index];
    if (!editor) throw new Error(`Note ${index} has no editor.`);
    return editor;
  }

  /** Creates the editor for note `index` with its starting content, replacing any editor already there. */
  create(index: number): Editor {
    this.destroy(index);
    const started = performance.now();
    const element = document.createElement('div');
    this.containers[index].replaceChildren(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit],
      content: this.specs[index].content,
      onTransaction: ({ transaction }) => this.onTransaction?.(transaction.docChanged),
    });
    this.editors[index] = editor;
    this.createMs[index] = performance.now() - started;
    return editor;
  }

  destroy(index: number): void {
    this.editors[index]?.destroy();
    this.editors[index] = null;
    this.containers[index].replaceChildren();
  }

  /** Keeps `count` editors, always including note `keep`, and creates or destroys the rest. */
  setCount(count: number, keep = 0): void {
    const others = this.specs.map((_, index) => index).filter((index) => index !== keep);
    const wanted = new Set([keep, ...others.slice(0, Math.max(0, count - 1))]);
    this.specs.forEach((_, index) => {
      if (wanted.has(index) && !this.editors[index]) this.create(index);
      if (!wanted.has(index)) this.destroy(index);
    });
  }

  /** Focuses note `index` and places the caret. Doesn't scroll: the world has no scrollbars. */
  focus(index: number, place: CaretPlace): void {
    const editor = this.editor(index);
    const position = place === 'middle' ? middlePosition(editor.state.doc) : 'end';
    editor.chain().focus(position, { scrollIntoView: false }).run();
  }

  /** The index of the note whose editor has the caret, or -1. */
  focused(): number {
    return this.editors.findIndex((candidate) => candidate?.isFocused);
  }

  /** The caret of the focused editor, or null when no editor has the caret. */
  caret(): CaretRect | null {
    const editor = this.editors[this.focused()];
    if (!editor) return null;
    const coords = editor.view.coordsAtPos(editor.state.selection.head);
    return { left: coords.left, top: coords.top, bottom: coords.bottom, height: coords.bottom - coords.top };
  }

  /** The center of note `index` across, in world pixels. */
  centerX(index: number): number {
    return this.specs[index].x + this.specs[index].width / 2;
  }

  /** How tall note `index` is on the page, in world pixels. */
  height(index: number): number {
    return this.containers[index].offsetHeight;
  }
}
