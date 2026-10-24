// Completion for [[page links]]: typing "[[" opens a list of pages that follows the words typed after it, and
// "[[Page#" lists that page's headings. Up and Down move, Enter and Tab choose, Escape closes, and the editor
// keeps focus: the list is a listbox the editor points at with aria-activedescendant. Plain DOM, like the slash
// menu's trigger, because it hangs off ProseMirror's view.
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { linkFor } from '../../../services/search/text';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { maybeSearchClient } from '../client';
import { resolveNow } from './resolver';
import styles from '../search.module.css';

const LEAF = '￼';
const MAX_ITEMS = 8;

export interface Session {
  /** Where the "[[" starts. */
  from: number;
  /** The caret. */
  to: number;
  query: string;
  /** The words after "#": the list holds the headings of the page named before it. */
  heading: string | null;
}

/** The open completion at the caret, or null. Never inside code, and never while a range is selected. */
export function sessionAt(state: EditorState): Session | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.spec.code)) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF);
  const match = /\[\[([^\][#\n]{0,80})(?:#([^\][\n]{0,80}))?$/.exec(before);
  if (!match) return null;
  return {
    from: $from.start() + match.index,
    to: $from.pos,
    query: match[1],
    heading: match[2] ?? null,
  };
}

interface Item {
  label: string;
  /** The link text that replaces what was typed. */
  insert: string;
}

async function itemsFor(session: Session): Promise<Item[]> {
  const client = maybeSearchClient();
  if (!client) return [];
  if (session.heading !== null) {
    const answer = await resolveNow({ title: session.query.trim() });
    const page = answer?.targets[0];
    if (!page) return [];
    const wanted = session.heading.toLowerCase();
    const headings = await client.headings(page.page);
    return headings
      .filter((heading) => heading.text.toLowerCase().includes(wanted))
      .slice(0, MAX_ITEMS)
      .map((heading) => ({ label: heading.text, insert: linkFor(page.title, heading.text) }));
  }
  const pages = await client.suggestPages(session.query.trim(), MAX_ITEMS);
  return pages.map((page) => ({ label: page.title || t('tree.page.noneTitle'), insert: linkFor(page.title) }));
}

export interface Suggest {
  /** Looks at the caret again: opens, follows, or closes the list. */
  update(): void;
  /** Handles Up, Down, Enter, Tab, and Escape while the list is open. Returns whether it used the key. */
  key(event: KeyboardEvent): boolean;
  destroy(): void;
}

let counter = 0;

const ARIA = ['aria-expanded', 'aria-controls', 'aria-activedescendant', 'aria-haspopup'];

class SuggestList implements Suggest {
  private readonly listId = `page-link-list-${(counter += 1)}`;
  private session: Session | null = null;
  private items: Item[] = [];
  private active = 0;
  private box: HTMLElement | null = null;
  /** The "[[" the person pressed Escape on: it stays closed until they type another. */
  private dismissedAt: number | null = null;
  private latest = 0;

  constructor(private readonly view: EditorView) {}

  update(): void {
    if (this.view.composing) return;
    const next = sessionAt(this.view.state);
    if (!next || next.from === this.dismissedAt) {
      if (!next) this.dismissedAt = null;
      if (this.session) this.close();
      return;
    }
    const same = this.session?.from === next.from;
    if (same && this.session?.query === next.query && this.session.heading === next.heading) {
      this.session = next;
      return;
    }
    if (!same) this.active = 0;
    this.refresh(next);
  }

  key(event: KeyboardEvent): boolean {
    if (!this.session || (event.ctrlKey && event.key !== 'Enter') || event.altKey || event.metaKey) return false;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        return this.step(event.key === 'ArrowDown' ? 1 : -1);
      case 'Enter':
      case 'Tab':
        return event.shiftKey ? false : this.accept();
      case 'Escape':
        this.dismissedAt = this.session.from;
        this.close();
        return true;
      default:
        return false;
    }
  }

  destroy(): void {
    this.close();
  }

  private step(by: number): boolean {
    if (this.items.length === 0) return false;
    this.active = (this.active + by + this.items.length) % this.items.length;
    this.render();
    return true;
  }

  private close(): void {
    this.session = null;
    this.items = [];
    this.box?.remove();
    this.box = null;
    ARIA.forEach((name) => this.view.dom.removeAttribute(name));
  }

  private refresh(next: Session): void {
    const id = ++this.latest;
    this.session = next;
    void itemsFor(next)
      .catch(() => [])
      .then((found) => {
        if (id !== this.latest || !this.session) return;
        this.items = found;
        this.active = Math.min(this.active, Math.max(0, found.length - 1));
        this.render();
        if (found.length) announce(t('search.links.suggestionCount', { count: found.length }));
      });
  }

  private accept(): boolean {
    if (!this.session) return false;
    const item = this.items[this.active];
    const typed = this.session.query.trim();
    const text = item ? item.insert : typed ? linkFor(typed) : null;
    if (text === null) {
      this.close();
      return false;
    }
    const { from, to } = this.session;
    this.close();
    this.view.dispatch(this.view.state.tr.insertText(text, from, to));
    return true;
  }

  private ensureBox(): HTMLElement {
    if (this.box) return this.box;
    const box = document.createElement('div');
    box.id = this.listId;
    box.className = styles.suggest;
    box.setAttribute('role', 'listbox');
    box.setAttribute('aria-label', t('search.links.suggestions'));
    document.body.append(box);
    this.box = box;
    return box;
  }

  private option(item: Item, at: number): HTMLElement {
    const option = document.createElement('div');
    option.id = `${this.listId}-${at}`;
    option.className = styles.suggestOption;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(at === this.active));
    option.textContent = item.label;
    // The pointer chooses without taking focus from the editor.
    option.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.active = at;
      this.accept();
    });
    return option;
  }

  private render(): void {
    if (!this.session || this.items.length === 0) {
      this.box?.remove();
      this.box = null;
      this.view.dom.removeAttribute('aria-activedescendant');
      return;
    }
    const box = this.ensureBox();
    box.replaceChildren(...this.items.map((item, at) => this.option(item, at)));
    const at = this.view.coordsAtPos(this.session.to);
    box.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - box.offsetWidth - 8))}px`;
    box.style.top = `${at.bottom + 4}px`;
    const { dom } = this.view;
    dom.setAttribute('aria-haspopup', 'listbox');
    dom.setAttribute('aria-expanded', 'true');
    dom.setAttribute('aria-controls', this.listId);
    dom.setAttribute('aria-activedescendant', `${this.listId}-${this.active}`);
  }
}

export function createSuggest(view: EditorView): Suggest {
  return new SuggestList(view);
}
