// The spelling menu (ARCHITECTURE.md section 16.4): up to 5 suggestions, Add to dictionary, and Ignore. F7 opens it
// on the word it selects. Right-click, long press, Shift+F10, or the Menu key on a misspelled word opens it with Cut,
// Copy, Paste, and Select all after those items.
import type { Editor } from '@tiptap/core';
import {
  rangeOver,
  spellingHighlights,
  TEXTBLOCK_SELECTOR,
  textblockText,
} from '../../../editor/extensions/spellingText';
import { META_COMMAND } from '../../../editor/meta';
import { t } from '../../../strings/t';
import { announce, editMenu, openMenu } from '../../../ui';
import type { MenuAnchor, MenuItemSpec } from '../../../ui';
import { shownPool } from '../pool/shown';
import { spellingEngine } from './current';
import type { SpellingEngine } from './engine';

export interface SpellingMenuOptions {
  editor: Editor;
  from: number;
  to: number;
  word: string;
  engine: SpellingEngine;
  /** F7 says the word and its first suggestion. */
  announceWord: boolean;
  anchor?: MenuAnchor;
  /** Items after the spelling ones, such as the edit menu's. */
  more?: readonly MenuItemSpec[];
}

/** The menu's items for a misspelled word: suggestions first, so Enter takes the first. */
export function spellingItems(options: SpellingMenuOptions, suggestions: readonly string[]): MenuItemSpec[] {
  const { editor, from, to, word, engine } = options;
  const replace = (replacement: string) => {
    const { state } = editor;
    if (state.doc.textBetween(from, to) !== word) return;
    editor.view.dispatch(state.tr.insertText(replacement, from, to).setMeta(META_COMMAND, true));
    editor.view.focus();
  };
  const items: MenuItemSpec[] = suggestions.map((suggestion, index) => ({
    id: `suggestion.${index}`,
    label: suggestion,
    onSelect: () => replace(suggestion),
  }));
  if (!items.length) items.push({ id: 'none', label: t('spelling.menu.noSuggestions'), disabled: true });
  items.push(
    { id: 'add', label: t('spelling.menu.add'), separatorBefore: true, onSelect: () => void engine.addWord(word) },
    { id: 'ignore', label: t('spelling.menu.ignore'), onSelect: () => engine.ignore(word) },
  );
  const more = (options.more ?? []).map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item));
  return [...items, ...more];
}

/** Opens the spelling menu for the word between `from` and `to`. */
export async function openSpellingMenu(options: SpellingMenuOptions): Promise<string | null> {
  const suggestions = await options.engine.suggest(options.word);
  if (options.announceWord) {
    const first = suggestions[0] ? ` ${t('spelling.first', { word: suggestions[0] })}` : '';
    announce(t('spelling.misspelled', { word: options.word, count: suggestions.length }) + first);
  }
  const coords = options.editor.view.coordsAtPos(options.from);
  return openMenu({
    label: t('spelling.menu.label'),
    items: spellingItems(options, suggestions),
    anchor: options.anchor ?? { x: coords.left, y: coords.bottom },
    returnFocus: options.editor.view.dom as HTMLElement,
  });
}

/** The point a context menu opened on, as a DOM position: the caret for keyboard menus. */
function pointOf(event: MouseEvent): { node: Node; offset: number } | null {
  const keyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0;
  if (keyboard) {
    const selection = document.getSelection();
    return selection?.anchorNode ? { node: selection.anchorNode, offset: selection.anchorOffset } : null;
  }
  const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  return position ? { node: position.offsetNode, offset: position.offset } : null;
}

/**
 * Opens the spelling menu when a context menu starts on a misspelled word in a mounted editor. Runs before the app's
 * own context menu, which then leaves the event alone. Returns true when it handled the event.
 */
export function spellingContextMenu(event: MouseEvent): boolean {
  const engine = spellingEngine();
  const pool = shownPool.get();
  const target = event.target instanceof Element ? event.target : null;
  const host = target?.closest<HTMLElement>('[data-app-menu][data-block]');
  const editor = host?.dataset.block ? pool?.editor(host.dataset.block) : null;
  const point = pointOf(event);
  if (!engine?.active() || !host || !editor || !point || event.defaultPrevented) return false;
  const start = point.node instanceof Element ? point.node : point.node.parentElement;
  const element = start?.closest(TEXTBLOCK_SELECTOR);
  const entry = element && spellingHighlights.entry(element);
  if (!element || !entry || !host.contains(element)) return false;
  const extracted = textblockText(element);
  const node = extracted.nodes.find((item) => item.node === point.node);
  if (!node) return false;
  const offset = node.at + point.offset;
  const error = entry.errors.find((item) => item.start <= offset && offset <= item.start + item.length);
  const range = error && rangeOver(extracted, error.start, error.length);
  if (!error || !range) return false;
  event.preventDefault();
  const from = editor.view.posAtDOM(range.startContainer, range.startOffset);
  const to = editor.view.posAtDOM(range.endContainer, range.endOffset);
  const keyboard = event.clientX === 0 && event.clientY === 0;
  const anchor: MenuAnchor | undefined = keyboard ? undefined : { x: event.clientX, y: event.clientY };
  const more = editMenu({ target: target as Element, host, anchor: anchor ?? host }).items;
  const word = editor.state.doc.textBetween(from, to);
  void openSpellingMenu({ editor, from, to, word, engine, announceWord: false, anchor, more });
  return true;
}
