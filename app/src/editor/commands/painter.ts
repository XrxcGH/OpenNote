// The format painter, and copy and paste formatting (owner: text:editor-commands; text DESIGN.md 4.1). One click
// copies the formatting at the caret; the next selection receives it. Double-click locks it on until Escape. With a
// whole paragraph selected, including its end, it copies the paragraph's formatting and style too. The copied
// formatting also lives in a device store, so Ctrl+Shift+V pastes it on another page. Each application is one
// command transaction, so one undo step.
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { META_ELEMENT_DATA } from '../meta';
import { PARA_KEYS } from '../paragraph/attributes';
import { fromChange, runCommand } from './command';
import type { Change, Command } from './command';
import { KEPT_ON_CLEAR, clearFormattingChange } from './marks';
import { paraTargets } from './paragraph';

export interface CopiedMark {
  type: string;
  attrs: Record<string, unknown>;
}

/** What the painter copied: run formats, and a paragraph's formatting and style when a whole one was selected. */
export interface CopiedFormat {
  marks: CopiedMark[];
  para?: { attrs: Record<string, unknown>; style: string | null };
}

const STORE_KEY = 'opennote.formatPainter';

/** Whether the selection covers a whole textblock, from its start through its end. */
function wholeParagraph(state: EditorState): boolean {
  const { $from, $to, empty } = state.selection;
  if (empty || $from.parentOffset !== 0 || !$from.parent.isTextblock) return false;
  return $to.pos >= $from.end() || !$from.sameParent($to);
}

/** The formatting at the caret, or of the selection's first character. */
export function copyFormat(state: EditorState): CopiedFormat {
  const { selection } = state;
  let marks = selection.empty ? (state.storedMarks ?? selection.$from.marks()) : null;
  if (!marks) {
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (!marks && node.isText) marks = node.marks;
      return !marks;
    });
  }
  const copied: CopiedFormat = {
    marks: (marks ?? [])
      .filter((mark) => !KEPT_ON_CLEAR.has(mark.type.name))
      .map((mark) => ({ type: mark.type.name, attrs: { ...mark.attrs } })),
  };
  if (wholeParagraph(state)) {
    const target = paraTargets(state.doc, selection.from, selection.from)[0];
    const block = selection.$from.parent;
    if (target) {
      const attrs = Object.fromEntries(
        PARA_KEYS.filter((key) => key !== 'list').map((key) => [key, target.node.attrs[key] ?? null]),
      );
      copied.para = { attrs, style: (block.attrs.style as string | null | undefined) ?? null };
    }
  }
  return copied;
}

/** Puts copied formatting on the selection: its run formats replace the selection's, and a copied paragraph's
 * formatting and style replace those of the selected paragraphs. */
export function pasteFormatChange(format: CopiedFormat): Change {
  return (tr) => {
    const { schema } = tr.doc.type;
    const marks = format.marks.flatMap(({ type, attrs }) => {
      const markType = schema.marks[type];
      return markType && !KEPT_ON_CLEAR.has(type) ? [markType.create(attrs)] : [];
    });
    const before = tr.doc;
    const storedBefore = tr.storedMarks;
    clearFormattingChange(tr);
    if (tr.selection.empty) {
      const kept = tr.storedMarks ?? tr.selection.$from.marks();
      tr.setStoredMarks(marks.reduce((set, mark) => mark.addToSet(set), kept));
    } else {
      for (const range of tr.selection.ranges) {
        for (const mark of marks) tr.addMark(range.$from.pos, range.$to.pos, mark);
      }
    }
    if (format.para) {
      const { from, to } = tr.selection;
      for (const { node, pos } of paraTargets(tr.doc, from, to)) {
        for (const [key, value] of Object.entries(format.para.attrs)) {
          if ((node.attrs[key] ?? null) !== value) tr.setNodeAttribute(pos, key, value);
        }
      }
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        if ('style' in node.attrs && node.attrs.style !== format.para?.style) {
          tr.setNodeAttribute(pos, 'style', format.para?.style ?? null);
        }
        return false;
      });
      tr.setMeta(META_ELEMENT_DATA, true);
    }
    return !tr.doc.eq(before) || tr.storedMarks !== storedBefore;
  };
}

export function pasteFormat(format: CopiedFormat): Command {
  return fromChange(pasteFormatChange(format));
}

// ---- The device store ----

function store(format: CopiedFormat): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(format));
  } catch {
    // A full or blocked store keeps the formatting for this window only.
  }
}

let copied: CopiedFormat | null = null;

/** The formatting copied last, in this window or another page. */
export function copiedFormat(): CopiedFormat | null {
  if (copied) return copied;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as CopiedFormat).marks)) {
      return parsed as CopiedFormat;
    }
  } catch {
    // Unreadable stored formatting counts as none.
  }
  return null;
}

/** Copy formatting (Word Ctrl+Shift+C). */
export function copyFormatting(state: EditorState): CopiedFormat {
  copied = copyFormat(state);
  store(copied);
  return copied;
}

/** Paste formatting (Word Ctrl+Shift+V): false when nothing was copied. */
export function pasteFormatting(): Command {
  return (state, dispatch) => {
    const format = copiedFormat();
    return format ? pasteFormat(format)(state, dispatch) : false;
  };
}

// ---- The painter on an editor ----

interface Armed {
  editor: Editor;
  locked: boolean;
  stop(): void;
}

let armed: Armed | null = null;

/** Whether the painter is on, and whether it is locked. */
export function painterState(): { locked: boolean } | null {
  return armed ? { locked: armed.locked } : null;
}

/** Turns the painter off. */
export function stopPainter(): void {
  armed?.stop();
  armed = null;
}

/**
 * Applies the painter to the editor's selection, when it is on and the selection has text. A painter that is not
 * locked turns off after one application. Returns whether it applied.
 */
export function painterSelectionDone(editor: Editor): boolean {
  if (!armed || armed.editor !== editor || editor.state.selection.empty || !copied) return false;
  const ran = runCommand(editor, pasteFormat(copied), { focus: false });
  if (ran && !armed.locked) stopPainter();
  return ran;
}

/** Turns the painter on with the formatting at the editor's selection: once, or locked until Escape. */
export function startPainter(editor: Editor, options: { locked?: boolean } = {}): CopiedFormat {
  stopPainter();
  const format = copyFormatting(editor.state);
  const dom = editor.view.dom;
  const done = () => queueMicrotask(() => painterSelectionDone(editor));
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') stopPainter();
    else if (event.shiftKey || event.key === 'Shift') done();
  };
  dom.addEventListener('pointerup', done);
  dom.addEventListener('keyup', onKey);
  dom.classList.add('opennote-painter');
  armed = {
    editor,
    locked: options.locked ?? false,
    stop() {
      dom.removeEventListener('pointerup', done);
      dom.removeEventListener('keyup', onKey);
      dom.classList.remove('opennote-painter');
    },
  };
  return format;
}
