// The title band (ARCHITECTURE.md section 5.8; owner WP3). The page title sits in the world at x 48 and y 24, so
// it zooms and prints with the page. It is a heading around a single-line textbox: heading navigation finds it, its
// name comes from its text, and the placeholder sits on a role that allows one. Typing sends setPage with the
// title, coalesced as typing. Enter, or Arrow Down at its end, moves into the page.
import { t } from '../../../strings/t';
import styles from './title.module.css';

/** Typing in the title is sent this long after the last key, or at once on blur or Enter. */
export const TITLE_FLUSH_MS = 300;

export interface TitleOptions {
  title: string;
  /** "Changed Sep 23, 2026", or null. */
  changed: string | null;
  readOnly: boolean;
  /** The band the page view showed while the page loaded (TitleSlot.tsx). It moves into the world with its focus. */
  band?: HTMLElement | null;
  send(title: string): void;
  /** Enter, or Arrow Down at the end: focus the first text block in reading order. */
  enterPage(): void;
}

export interface TitleBand {
  readonly element: HTMLElement;
  readonly heading: HTMLHeadingElement;
  readonly textbox: HTMLElement;
  /** Undo or another window changed the title. Ignored while the person is typing in it. */
  setTitle(title: string): void;
  destroy(): void;
}

function caretAtEnd(textbox: HTMLElement): boolean {
  const selection = textbox.ownerDocument.getSelection();
  if (!selection || !selection.isCollapsed || !selection.focusNode) return false;
  const range = textbox.ownerDocument.createRange();
  range.selectNodeContents(textbox);
  range.setStart(selection.focusNode, selection.focusOffset);
  return range.toString().length === 0;
}

export function createTitle(world: HTMLElement, options: TitleOptions): TitleBand {
  const doc = world.ownerDocument;
  const adopted = options.band?.querySelector('h1') ?? null;
  const element = adopted ? options.band! : doc.createElement('div');
  element.className = styles.band;
  const heading = adopted ?? doc.createElement('h1');
  heading.className = styles.title;
  heading.tabIndex = -1;
  heading.dataset.pageTitle = '';
  const textbox = doc.createElement('span');
  textbox.className = styles.text;
  textbox.setAttribute('role', 'textbox');
  textbox.setAttribute('aria-multiline', 'false');
  textbox.setAttribute('aria-label', t('page.title.label'));
  textbox.setAttribute('aria-placeholder', t('page.title.placeholder'));
  textbox.dataset.placeholder = t('page.title.placeholder');
  textbox.dataset.scope = 'editor';
  textbox.spellcheck = true;
  if (!options.readOnly) textbox.setAttribute('contenteditable', 'plaintext-only');
  textbox.textContent = options.title;
  const focused = adopted !== null && doc.activeElement === adopted;
  heading.replaceChildren(textbox);
  if (!adopted) {
    element.append(heading);
    if (options.changed) {
      const changed = doc.createElement('p');
      changed.className = styles.changed;
      changed.textContent = options.changed;
      element.append(changed);
    }
  }
  world.prepend(element);
  // Moving the band blurs its heading; the heading the tree focused keeps focus.
  if (focused) heading.focus({ preventScroll: true });

  let sent = options.title;
  let timer = 0;
  const flush = () => {
    window.clearTimeout(timer);
    timer = 0;
    const title = (textbox.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (title === sent) return;
    sent = title;
    options.send(title);
  };
  const onInput = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, TITLE_FLUSH_MS);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const enter = event.key === 'Enter';
    if (!enter && !(event.key === 'ArrowDown' && caretAtEnd(textbox))) return;
    event.preventDefault();
    flush();
    options.enterPage();
  };
  textbox.addEventListener('input', onInput);
  textbox.addEventListener('keydown', onKey);
  textbox.addEventListener('blur', flush);
  return {
    element,
    heading,
    textbox,
    setTitle(title) {
      if (doc.activeElement === textbox) return;
      sent = title;
      textbox.textContent = title;
    },
    destroy() {
      flush();
      textbox.removeEventListener('input', onInput);
      textbox.removeEventListener('keydown', onKey);
      textbox.removeEventListener('blur', flush);
      // An adopted band belongs to the page view, which has taken it back or given it to the next page.
      if (!adopted) element.remove();
    },
  };
}
