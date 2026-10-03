// The slash menu (ARCHITECTURE.md section 17.1; owner: WP4): a listbox of options in the top layer, under the "/".
// The editor keeps focus and gets aria-controls, aria-haspopup, and aria-activedescendant while it's open. A
// textbox can't take aria-expanded, so the menu doesn't use it.
//
// NVDA doesn't reliably follow aria-activedescendant in rich text, so each highlighted option is also announced
// ("Heading 2, 3 of 14."), and so is the result count after typing pauses ("5 results.").
//
// Choosing an item removes the "/" and the filter, then runs the item's command.
import { isEnabled } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
import { slashSessionOf } from '../../../editor/extensions/slash';
import type { SlashMenuUi, SlashSession } from '../../../editor/extensions/slash';
import { commands } from '../../../registries';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { slashItems } from '../registries';
import type { SlashItemDef } from '../registries';
import styles from './slashMenu.module.css';

const GROUPS: readonly SlashItemDef['group'][] = ['basic', 'lists', 'media', 'advanced'];
/** Headings 4 to 6 show only once the filter asks for them, so the short list stays short. */
const ON_REQUEST = new Set(['editor.heading4', 'editor.heading5', 'editor.heading6']);
const COUNT_PAUSE_MS = 600;

/** The items that match a filter, by group and then order. Hidden: flags off and commands not registered. */
export function slashMatches(query: string): SlashItemDef[] {
  const needle = query.trim().toLowerCase();
  return slashItems
    .list()
    .filter((item) => (!item.flag || isEnabled(item.flag)) && commands.get(item.command) !== undefined)
    .filter((item) => (needle === '' ? !ON_REQUEST.has(item.id) : matches(item, needle)))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order);
}

function matches(item: SlashItemDef, needle: string): boolean {
  const title = t(item.title).toLowerCase();
  const words = `${title} ${t(item.keywords).toLowerCase()}`.split(/\s+/);
  return title.includes(needle) || words.some((word) => word.startsWith(needle));
}

let counter = 0;

class SlashMenu implements SlashMenuUi {
  private readonly list: HTMLElement;
  private items: SlashItemDef[] = [];
  private active = 0;
  private countTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly id = `opennote-slash-${++counter}`;

  constructor(private readonly session: SlashSession) {
    this.list = document.createElement('div');
    this.list.id = this.id;
    this.list.className = styles.menu;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', t('editor.slash.label'));
    this.list.setAttribute('popover', 'manual');
    // A long list scrolls, so it is focusable; the editor keeps focus, and Tab chooses an item.
    this.list.tabIndex = 0;
    // Choosing with the pointer keeps focus in the editor.
    this.list.addEventListener('pointerdown', (event) => event.preventDefault());
    this.list.addEventListener('click', (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (option) this.choose(Number(option.dataset.index));
    });
    document.body.append(this.list);
    (this.list as HTMLElement & { showPopover?(): void }).showPopover?.();
    const editable = session.view.dom;
    editable.setAttribute('aria-controls', this.id);
    editable.setAttribute('aria-haspopup', 'listbox');
    this.update();
  }

  private query(): string {
    return slashSessionOf(this.session.view)?.query ?? this.session.query;
  }

  update(): void {
    this.items = slashMatches(this.query());
    this.active = 0;
    this.render();
    this.place();
    clearTimeout(this.countTimer);
    this.countTimer = setTimeout(
      () => announce(t('editor.slash.results', { count: this.items.length })),
      COUNT_PAUSE_MS,
    );
  }

  private place(): void {
    const at = this.session.rect();
    this.list.style.insetInlineStart = `${Math.max(0, at.left)}px`;
    this.list.style.insetBlockStart = `${at.bottom + 4}px`;
  }

  private render(): void {
    this.list.replaceChildren(
      ...this.items.map((item, index) => {
        const option = document.createElement('div');
        option.id = `${this.id}-${index}`;
        option.className = styles.option;
        option.setAttribute('role', 'option');
        option.dataset.index = String(index);
        option.textContent = t(item.title);
        return option;
      }),
    );
    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = styles.empty;
      empty.textContent = t('editor.slash.results', { count: 0 });
      this.list.append(empty);
    }
    this.highlight(false);
  }

  private highlight(speak: boolean): void {
    const options = [...this.list.querySelectorAll<HTMLElement>('[role="option"]')];
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === this.active)));
    const current = options[this.active];
    const editable = this.session.view.dom;
    if (current) editable.setAttribute('aria-activedescendant', current.id);
    else editable.removeAttribute('aria-activedescendant');
    current?.scrollIntoView?.({ block: 'nearest' });
    if (speak && current) {
      const name = current.textContent ?? '';
      announce(t('editor.slash.option', { name, position: this.active + 1, count: this.items.length }));
    }
  }

  key(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.session.close();
      return true;
    }
    if (this.items.length === 0) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + this.items.length) % this.items.length;
      this.highlight(true);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      this.choose(this.active);
      return true;
    }
    return false;
  }

  private choose(index: number): void {
    const item = this.items[index];
    if (!item) return;
    this.session.remove();
    void executeCommand(item.command, undefined, 'menu');
  }

  close(): void {
    clearTimeout(this.countTimer);
    const editable = this.session.view.dom;
    editable.removeAttribute('aria-controls');
    editable.removeAttribute('aria-activedescendant');
    editable.removeAttribute('aria-haspopup');
    this.list.remove();
  }
}

/** Opens the page's menu on a session the editor announced, unless it closed while this module loaded. */
export function openSlashMenu(session: SlashSession): SlashMenuUi | null {
  if (!slashSessionOf(session.view)) return null;
  const menu = new SlashMenu(session);
  session.attach(menu);
  return menu;
}
