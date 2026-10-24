// F7 and Shift+F7 (ARCHITECTURE.md section 16.4): the next or previous misspelled word in reading order across every
// text block, whether its editor is mounted or not. The block mounts, the word is selected, and the spelling menu
// opens with the suggestions; Enter takes the first.
import type { Editor } from '@tiptap/core';
import { unfoldTo } from '../../../editor/commands/fold';
import {
  isCheckable,
  rangeOver,
  spellingHighlights,
  TEXTBLOCK_SELECTOR,
  textblockText,
} from '../../../editor/extensions/spellingText';
import type { SpellRange } from '../../../editor/extensions/spellingText';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shownPool } from '../pool/shown';
import type { EditorPool } from '../pool/pool';
import { shownViewport } from '../viewport/viewport';
import { spellingEngine } from './current';
import { openSpellingMenu } from './menu';

interface Spot {
  element: Element;
  error: SpellRange;
}

/** Where the caret or selection starts, as a textblock element and an offset in its text. */
function caretSpot(pool: EditorPool): { element: Element; offset: number; selected: boolean } | null {
  const active = pool.active();
  if (!active) return null;
  const { view } = active.editor;
  const { from, empty } = view.state.selection;
  const { node } = view.domAtPos(from);
  const element = (node instanceof Element ? node : node.parentElement)?.closest(TEXTBLOCK_SELECTOR);
  if (!element || !view.dom.contains(element)) return null;
  return { element, offset: from - view.posAtDOM(element, 0), selected: !empty };
}

/** The next or previous error after the caret in document order, wrapping around the page once. */
function findError(world: Element, pool: EditorPool, direction: 1 | -1): Spot | null {
  const elements = spellingHighlights.shownIn(world);
  const spots = elements.flatMap((element, index) =>
    [...(spellingHighlights.entry(element)?.errors ?? [])]
      .sort((a, b) => a.start - b.start)
      .map((error) => ({ element, error, index })),
  );
  if (!spots.length) return null;
  const caret = caretSpot(pool);
  if (!caret) return direction === 1 ? spots[0] : spots[spots.length - 1];
  // A caret in a textblock without squiggles sits between the textblocks around it.
  const listed = elements.indexOf(caret.element);
  const precedes = (element: Element) =>
    Boolean(element.compareDocumentPosition(caret.element) & Node.DOCUMENT_POSITION_FOLLOWING);
  const at = listed >= 0 ? listed : elements.filter(precedes).length - 0.5;
  const after = (spot: (typeof spots)[number]) =>
    spot.index > at ||
    (spot.index === at &&
      (caret.selected ? spot.error.start > caret.offset : spot.error.start + spot.error.length >= caret.offset));
  const before = (spot: (typeof spots)[number]) =>
    spot.index < at || (spot.index === at && spot.error.start < caret.offset);
  if (direction === 1) return spots.find(after) ?? spots[0];
  return [...spots].reverse().find(before) ?? spots[spots.length - 1];
}

/** Mounts the error's block if needed, and returns its editor and the word's positions there. */
function mountAt(pool: EditorPool, spot: Spot): { editor: Editor; from: number; to: number } | null {
  const wrapper = spot.element.closest<HTMLElement>('[data-block-id]');
  const block = wrapper?.dataset.blockId;
  if (!wrapper || !block) return null;
  const textblocks = () => [...wrapper.querySelectorAll(TEXTBLOCK_SELECTOR)].filter(isCheckable);
  const index = textblocks().indexOf(spot.element);
  const text = textblockText(spot.element).text;
  const editor = pool.editor(block) ?? pool.mount(block, null, 'target');
  if (!editor) return null;
  const element = textblocks()[index];
  if (!element || textblockText(element).text !== text) return null;
  const range = rangeOver(textblockText(element), spot.error.start, spot.error.length);
  if (!range) return null;
  const from = editor.view.posAtDOM(range.startContainer, range.startOffset);
  const to = editor.view.posAtDOM(range.endContainer, range.endOffset);
  pool.mount(block, { kind: 'selection', anchor: from, head: to }, 'target');
  unfoldTo(editor, from);
  editor.view.focus();
  return { editor, from, to };
}

/** Moves to the next (1) or previous (-1) misspelled word and opens its menu. Resolves false when there is none. */
export async function moveToError(direction: 1 | -1): Promise<boolean> {
  const viewport = shownViewport.get();
  const pool = shownPool.get();
  const engine = spellingEngine();
  if (!viewport || !pool || !engine) return false;
  const spot = findError(viewport.world, pool, direction);
  const target = spot && mountAt(pool, spot);
  if (!target) {
    announce(t('spelling.none'));
    return false;
  }
  const { editor, from, to } = target;
  editor.commands.scrollIntoView();
  const word = editor.state.doc.textBetween(from, to);
  await openSpellingMenu({ editor, from, to, word, engine, announceWord: true });
  return true;
}
