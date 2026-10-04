// Keys between blocks (ARCHITECTURE.md section 8.4; owner: WP4). Each block is its own editing host, so crossing
// blocks is app code here.
//
// - Arrow Up and Down on a flowing block's first or last line move to the flowing neighbor, near the same x. An
//   image neighbor is selected as an object. Arrows in a floating text box stay inside it.
// - Shift+Arrow past a flowing block's edge selects both blocks as objects, through host.selectBlocks.
// - Backspace at the very start merges into the text block above, or selects the image or table there.
// - Ctrl+A selects the text, and a second Ctrl+A selects every block. Escape selects this block as an object.
// - Every editor is described by one hidden hint: "Press Escape, then Tab, to leave the text box."
import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import { MERGE_BLOCKS_EVENT } from '../commands/state';
import type { MergeBlocksDetail } from '../commands/state';
import type { EditorHost } from '../host';

export const ESCAPE_HINT_ID = 'opennote-escape-hint';

/** The page's one hidden Escape hint, made on first use. */
function ensureHint(doc: Document): void {
  if (doc.getElementById(ESCAPE_HINT_ID)) return;
  const hint = doc.createElement('div');
  hint.id = ESCAPE_HINT_ID;
  hint.hidden = true;
  hint.textContent = t('editor.escapeHint');
  doc.body.append(hint);
}

const blockOf = (view: EditorView): string | null => view.dom.getAttribute('data-block');
const wrapperOf = (view: EditorView): HTMLElement | null => view.dom.closest<HTMLElement>('[data-block-id]');

/** Floating blocks sit at their frame; flowing ones stack in the column. */
export function isFloating(wrapper: HTMLElement): boolean {
  const position = wrapper.ownerDocument.defaultView?.getComputedStyle(wrapper).position;
  // Without layout (tests), the inline position says it: a text box's top is the --frame-y property, not top.
  const top = wrapper.style.top !== '' || wrapper.style.getPropertyValue('--frame-y') !== '';
  return position === 'absolute' || position === 'fixed' || (wrapper.style.left !== '' && top);
}

/** The page's flowing blocks in reading order. */
function flowingBlocks(wrapper: HTMLElement): HTMLElement[] {
  const page = wrapper.closest('[data-scope~="page"]') ?? wrapper.ownerDocument;
  return [...page.querySelectorAll<HTMLElement>('[data-block-id]')].filter((block) => !isFloating(block));
}

function neighbor(wrapper: HTMLElement, direction: -1 | 1): HTMLElement | null {
  const blocks = flowingBlocks(wrapper);
  return blocks[blocks.indexOf(wrapper) + direction] ?? null;
}

// A block's editing root is editable only while its editor is mounted; before that it is the same element with the
// textbox role, and focusing it mounts the editor.
const editableIn = (wrapper: HTMLElement) =>
  wrapper.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"][data-scope="editor"]');
const isTextBlock = (wrapper: HTMLElement) =>
  editableIn(wrapper)?.getAttribute('role') === 'textbox' && !wrapper.querySelector('table');

function atDocEdge(state: EditorState, direction: -1 | 1): boolean {
  const { $head } = state.selection;
  const edge = direction < 0 ? Selection.atStart(state.doc) : Selection.atEnd(state.doc);
  return edge.$head.parent === $head.parent && edge.$head.start() === $head.start();
}

/** Puts the caret in another block's editable at `x`, on its first line going down or last line going up. */
function placeCaret(target: HTMLElement, x: number, direction: -1 | 1): void {
  target.focus({ preventScroll: false });
  const rect = target.getBoundingClientRect();
  const y = direction > 0 ? rect.top + 2 : rect.bottom - 2;
  const doc = target.ownerDocument;
  const selection = doc.getSelection();
  const fromPoint = (
    doc as Document & { caretPositionFromPoint?(x: number, y: number): CaretPosition | null }
  ).caretPositionFromPoint?.(x, y);
  if (!selection) return;
  if (fromPoint && target.contains(fromPoint.offsetNode)) {
    selection.collapse(fromPoint.offsetNode, fromPoint.offset);
    return;
  }
  selection.selectAllChildren(target);
  if (direction > 0) selection.collapseToStart();
  else selection.collapseToEnd();
}

function caretX(view: EditorView): number {
  try {
    return view.coordsAtPos(view.state.selection.head).left;
  } catch {
    return view.dom.getBoundingClientRect().left;
  }
}

/** Whether the caret is on the textblock's first line going up, or its last going down. */
function onEdgeLine(view: EditorView, direction: -1 | 1): boolean {
  try {
    return view.endOfTextblock(direction < 0 ? 'up' : 'down');
  } catch {
    // Without layout (in tests), the textblock's edge counts.
    return true;
  }
}

/** Arrow Up or Down at a flowing block's edge: on to the neighbor, or select it when it isn't text. */
function arrow(view: EditorView, host: EditorHost, direction: -1 | 1, extend: boolean): boolean {
  const wrapper = wrapperOf(view);
  const block = blockOf(view);
  if (!wrapper || !block || isFloating(wrapper)) return false;
  if ((!extend && !view.state.selection.empty) || !atDocEdge(view.state, direction)) return false;
  if (!onEdgeLine(view, direction)) return false;
  const next = neighbor(wrapper, direction);
  const nextId = next?.dataset.blockId;
  if (!next || !nextId) return false;
  if (extend) {
    host.selectBlocks(direction < 0 ? [nextId, block] : [block, nextId], 'escalate');
    return true;
  }
  const target = editableIn(next);
  if (target) placeCaret(target, caretX(view), direction);
  else host.selectBlocks([nextId], 'escape');
  return true;
}

/** Backspace at the very start of a flowing block: merge into the text block above, or select what's there. */
function backspace(view: EditorView, host: EditorHost): boolean {
  const { selection } = view.state;
  const wrapper = wrapperOf(view);
  const block = blockOf(view);
  if (!selection.empty || !wrapper || !block || isFloating(wrapper)) return false;
  if (selection.from !== Selection.atStart(view.state.doc).from) return false;
  // A list item or quote at the start lifts first, as their own Backspace does.
  if (selection.$from.depth > 1) return false;
  const previous = neighbor(wrapper, -1);
  const previousId = previous?.dataset.blockId;
  if (!previous || !previousId) return false;
  if (!isTextBlock(previous)) {
    host.selectBlocks([previousId], 'escape');
    return true;
  }
  const detail: MergeBlocksDetail = { block, previous: previousId };
  view.dom.dispatchEvent(new CustomEvent(MERGE_BLOCKS_EVENT, { bubbles: true, detail }));
  return true;
}

/** Ctrl+A: the text first; when all of it is selected already, every block on the page. */
function selectAll(view: EditorView, host: EditorHost): boolean {
  const { selection, doc } = view.state;
  const all = selection.from <= Selection.atStart(doc).from && selection.to >= Selection.atEnd(doc).to;
  const wrapper = wrapperOf(view);
  if (!all || !wrapper) return false;
  const page = wrapper.closest('[data-scope~="page"]') ?? wrapper.ownerDocument;
  const blocks = [...page.querySelectorAll<HTMLElement>('[data-block-id]')]
    .map((element) => element.dataset.blockId)
    .filter((id): id is string => Boolean(id));
  host.selectBlocks(blocks, 'selectAll');
  return true;
}

function escape(view: EditorView, host: EditorHost): boolean {
  const block = blockOf(view);
  if (!block) return false;
  host.selectBlocks([block], 'escape');
  return true;
}

export function crossBlockExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'opennoteCrossBlock',
      // Before Tiptap's own Ctrl+A, so a second Ctrl+A reaches every block.
      priority: 900,
      addKeyboardShortcuts() {
        const view = () => this.editor.view;
        return {
          ArrowUp: () => arrow(view(), host, -1, false),
          ArrowDown: () => arrow(view(), host, 1, false),
          'Shift-ArrowUp': () => arrow(view(), host, -1, true),
          'Shift-ArrowDown': () => arrow(view(), host, 1, true),
          Backspace: () => backspace(view(), host),
          'Mod-a': () => selectAll(view(), host),
          Escape: () => escape(view(), host),
        };
      },
      addProseMirrorPlugins: () => [
        new Plugin({
          key: new PluginKey('opennoteEscapeHint'),
          view: (view) => {
            ensureHint(view.dom.ownerDocument);
            return {};
          },
          props: { attributes: { 'aria-describedby': ESCAPE_HINT_ID } },
        }),
      ],
    }),
  ];
}
