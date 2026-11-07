// The notes area under the page and the numbers on the references (ADR 0087).
//
// Numbers are drawn by one style sheet per page view: a rule for each reference ID puts its label after the atom,
// with an accessible name such as "Footnote 3". So the static text and the editor show the same number, and
// neither needs to know the page's other blocks. The notes area lists footnotes, then endnotes, each in number
// order. A note's text opens in an editor of its own when it is clicked or focused; its number goes back to the
// reference. A double-click on a reference goes to its note.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { t } from '../../strings/t';
import { createBlockEditor } from '../extensions/kit';
import type { EditorHost } from '../host';
import { renderStatic } from '../static';
import type { NotesModel, NotesPatch } from './model';
import { noteMarks } from './refs';
import type { NoteKind } from './refs';
import { NOTE_FORMATS, NOTE_RESTARTS, noteLabel, numberNotes, MAX_NOTE_START } from './numbering';
import type { NoteSettings, NotesSettings, NumberedNote, Numbering } from './numbering';
import { fitsNote, noteDoc, noteMarkdown } from './noteText';
import styles from './view.module.css';

/** Typing in a note goes this long after its last change, like typing in a text block. */
export const NOTE_IDLE = 300;

export interface NotesViewDeps {
  model: NotesModel;
  /** The flow column: the notes area goes right after it. */
  after: HTMLElement;
  /** Where the page's references are, for double-clicks. */
  root: HTMLElement;
  host: EditorHost;
  readOnly: boolean;
  /** The page's text blocks in reading order, with their documents as shown. */
  blocks(): readonly { id: string; doc: PMNode }[];
  /** Sends a change to a block's notes. `typing` lets the core join it to the last step. */
  sendNotes(block: string, patch: NotesPatch, typing: string | null): void;
  /** Sends a change to the page's note settings. */
  sendSettings(kind: NoteKind, settings: NoteSettings): void;
  /** Puts the caret right after the reference and shows it. */
  showRef(block: string, id: string): void;
}

export interface NotesView {
  /** Numbers the notes again in the next frame. */
  refresh(): void;
  /** Numbers the notes now. */
  refreshNow(): Numbering;
  numbering(): Numbering;
  /** Focuses a note's text. */
  focusNote(id: string): boolean;
  /** The note whose editor has the focus, or null. */
  focusedNote(): string | null;
  readonly element: HTMLElement;
  destroy(): void;
}

const cssString = (text: string) => `"${text.replace(/["\\]/g, (char) => `\\${char}`).replace(/\n/g, ' ')}"`;

/** The style rule that draws a reference's number. IDs are validated element IDs (D.9), so they need no escape. */
function numberRule(note: NumberedNote): string {
  const name = t(note.kind === 'foot' ? 'textNotes.footnoteName' : 'textNotes.endnoteName', { label: note.label });
  return `[data-footnote="${note.id}"]::after{content:${cssString(note.label)} / ${cssString(name)}}`;
}

/** The style sheet that numbers every reference of the page. */
export function numberSheet(numbering: Numbering): string {
  return [...numbering.byId.values()].map(numberRule).join('\n');
}

interface Item {
  li: HTMLLIElement;
  number: HTMLButtonElement;
  text: HTMLElement;
  body: HTMLElement;
  shown: string | null;
  editor: Editor | null;
  timer: ReturnType<typeof setTimeout> | null;
  note: NumberedNote;
}

class View implements NotesView {
  readonly element: HTMLElement;
  private readonly sheet: HTMLStyleElement;
  private readonly lists: Record<NoteKind, HTMLOListElement>;
  private readonly parts: Record<NoteKind, HTMLElement>;
  private readonly options: HTMLDetailsElement;
  private readonly items = new Map<string, Item>();
  private current: Numbering = { byId: new Map(), foot: [], end: [] };
  private frame = 0;
  private readonly stopModel: () => void;

  constructor(private readonly deps: NotesViewDeps) {
    const doc = deps.after.ownerDocument;
    this.sheet = doc.createElement('style');
    this.sheet.dataset.notes = '';
    this.element = doc.createElement('section');
    this.element.className = styles.notes!;
    // A press here is not on empty page, so it never adds a text box (pool/selectTool.ts).
    this.element.dataset.pageNotes = '';
    this.element.setAttribute('aria-label', t('textNotes.area'));
    this.element.hidden = true;
    this.parts = { foot: doc.createElement('div'), end: doc.createElement('div') };
    this.lists = { foot: doc.createElement('ol'), end: doc.createElement('ol') };
    for (const kind of ['foot', 'end'] as const) {
      const part = this.parts[kind];
      part.className = styles.part!;
      part.dataset.kind = kind;
      part.hidden = true;
      if (kind === 'foot') {
        const rule = part.appendChild(doc.createElement('hr'));
        rule.className = styles.rule!;
        rule.setAttribute('aria-hidden', 'true');
        part.setAttribute('aria-label', t('textNotes.footnotes'));
      } else {
        const heading = part.appendChild(doc.createElement('h2'));
        heading.className = styles.heading!;
        heading.textContent = t('textNotes.endnotes');
        part.setAttribute('role', 'doc-endnotes');
      }
      this.lists[kind].className = styles.list!;
      part.append(this.lists[kind]);
      this.element.append(part);
    }
    this.options = this.buildOptions(doc);
    this.element.append(this.options);
    deps.after.after(this.element);
    this.element.before(this.sheet);
    deps.root.addEventListener('dblclick', this.onDoubleClick);
    this.stopModel = deps.model.onChange(() => this.refresh());
    this.refreshNow();
  }

  numbering(): Numbering {
    return this.current;
  }

  refresh(): void {
    const view = this.element.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) {
      queueMicrotask(() => this.refreshNow());
      return;
    }
    this.frame ||= view.requestAnimationFrame(() => {
      this.frame = 0;
      this.refreshNow();
    });
  }

  refreshNow(): Numbering {
    const { model } = this.deps;
    const blocks = this.deps.blocks().map(({ id, doc }) => ({ id, marks: noteMarks(doc), notes: model.shown(id) }));
    this.current = numberNotes(blocks, model.settings());
    const sheet = numberSheet(this.current);
    if (this.sheet.textContent !== sheet) this.sheet.textContent = sheet;
    this.draw();
    return this.current;
  }

  focusNote(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.li.scrollIntoView?.({ block: 'nearest' });
    if (this.deps.readOnly) item.text.focus();
    else this.mount(item).commands.focus('end');
    return true;
  }

  focusedNote(): string | null {
    for (const [id, item] of this.items) if (item.editor?.isFocused) return id;
    return null;
  }

  destroy(): void {
    if (this.frame) this.element.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.stopModel();
    this.deps.root.removeEventListener('dblclick', this.onDoubleClick);
    for (const item of this.items.values()) this.unmount(item);
    this.items.clear();
    this.element.remove();
    this.sheet.remove();
  }

  private draw(): void {
    const seen = new Set<string>();
    for (const kind of ['foot', 'end'] as const) {
      const notes = this.current[kind];
      this.parts[kind].hidden = notes.length === 0;
      notes.forEach((note, index) => {
        seen.add(note.id);
        const item = this.items.get(note.id) ?? this.create(note);
        this.update(item, note);
        if (this.lists[kind].children[index] !== item.li)
          this.lists[kind].insertBefore(item.li, this.lists[kind].children[index] ?? null);
      });
    }
    for (const [id, item] of this.items) {
      if (seen.has(id)) continue;
      this.unmount(item);
      item.li.remove();
      this.items.delete(id);
    }
    this.element.hidden = this.items.size === 0;
    this.syncOptions();
  }

  private create(note: NumberedNote): Item {
    const doc = this.element.ownerDocument;
    const li = doc.createElement('li');
    li.className = styles.item!;
    li.dataset.note = note.id;
    const number = li.appendChild(doc.createElement('button'));
    number.type = 'button';
    number.className = styles.number!;
    const text = li.appendChild(doc.createElement('div'));
    text.className = styles.text!;
    text.tabIndex = 0;
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-multiline', 'true');
    if (this.deps.readOnly) text.setAttribute('aria-readonly', 'true');
    const body = text.appendChild(doc.createElement('div'));
    const item: Item = { li, number, text, body, shown: null, editor: null, timer: null, note };
    number.addEventListener('click', () => this.deps.showRef(item.note.block, item.note.id));
    text.addEventListener('focus', () => {
      if (!this.deps.readOnly && !item.editor) this.mount(item).commands.focus('end');
    });
    this.items.set(note.id, item);
    return item;
  }

  private update(item: Item, note: NumberedNote): void {
    item.note = note;
    item.li.setAttribute('role', note.kind === 'foot' ? 'doc-footnote' : 'listitem');
    item.number.textContent = note.label;
    item.number.setAttribute('aria-label', t('textNotes.backTo', { label: note.label }));
    const name = t(note.kind === 'foot' ? 'textNotes.footnoteName' : 'textNotes.endnoteName', { label: note.label });
    item.text.setAttribute('aria-label', name);
    // A reference whose note is missing still gets its number (R-FN-5).
    if (note.markdown === null) item.li.dataset.missing = '';
    else delete item.li.dataset.missing;
    const markdown = note.markdown ?? '';
    if (item.editor) {
      // An undo or another window changed the note while its editor is open: show the new text.
      if (item.timer === null && noteMarkdown(item.editor.state.doc) !== markdown) {
        item.editor.commands.setContent(noteDoc(markdown).toJSON(), { emitUpdate: false });
      }
      return;
    }
    if (item.shown === markdown) return;
    item.shown = markdown;
    renderStatic(noteDoc(markdown), item.body);
    item.text.title = note.markdown === null ? t('textNotes.missing') : '';
  }

  private mount(item: Item): Editor {
    if (item.editor) return item.editor;
    const root = this.element.ownerDocument.createElement('div');
    item.body.replaceWith(root);
    item.body = root;
    const editor = createBlockEditor(root, noteDoc(item.note.markdown ?? ''), {
      kind: 'text',
      block: item.note.id,
      host: this.deps.host,
    });
    editor.on('update', () => {
      if (item.timer) clearTimeout(item.timer);
      item.timer = setTimeout(() => this.save(item), NOTE_IDLE);
    });
    editor.on('blur', () => queueMicrotask(() => this.unmount(item)));
    item.editor = editor;
    item.text.tabIndex = -1;
    return editor;
  }

  private save(item: Item): void {
    if (item.timer) clearTimeout(item.timer);
    item.timer = null;
    if (!item.editor) return;
    const markdown = noteMarkdown(item.editor.state.doc);
    if (markdown === (item.note.markdown ?? '') || !fitsNote(markdown)) return;
    const { id, block, kind } = item.note;
    item.note = { ...item.note, markdown };
    this.deps.sendNotes(block, { [id]: { kind, markdown } }, `note:${id}`);
  }

  private unmount(item: Item): void {
    const { editor } = item;
    if (!editor || editor.isDestroyed) return;
    if (editor.isFocused) return;
    this.save(item);
    editor.destroy();
    item.editor = null;
    const body = this.element.ownerDocument.createElement('div');
    item.body.replaceWith(body);
    item.body = body;
    item.shown = null;
    item.text.tabIndex = 0;
    this.update(item, item.note);
  }

  private buildOptions(doc: Document): HTMLDetailsElement {
    const details = doc.createElement('details');
    details.className = styles.options!;
    details.hidden = this.deps.readOnly;
    const summary = details.appendChild(doc.createElement('summary'));
    summary.textContent = t('textNotes.options');
    for (const kind of ['foot', 'end'] as const) {
      const set = details.appendChild(doc.createElement('fieldset'));
      set.className = styles.fieldset!;
      set.dataset.kind = kind;
      set.appendChild(doc.createElement('legend')).textContent = t(
        kind === 'foot' ? 'textNotes.footnotes' : 'textNotes.endnotes',
      );
      const format = this.field(set, 'select', t('textNotes.format')) as HTMLSelectElement;
      format.dataset.field = 'format';
      for (const value of NOTE_FORMATS) {
        const option = format.appendChild(doc.createElement('option'));
        option.value = value;
        option.textContent = [1, 2, 3].map((n) => noteLabel(n, value)).join(', ');
      }
      const start = this.field(set, 'input', t('textNotes.start')) as HTMLInputElement;
      start.dataset.field = 'start';
      start.type = 'number';
      start.min = '0';
      start.max = String(MAX_NOTE_START);
      const restart = this.field(set, 'select', t('textNotes.restart')) as HTMLSelectElement;
      restart.dataset.field = 'restart';
      for (const value of NOTE_RESTARTS) {
        const option = restart.appendChild(doc.createElement('option'));
        option.value = value;
        option.textContent = t(value === 'continuous' ? 'textNotes.continuous' : 'textNotes.heading');
      }
      set.addEventListener('change', () => this.sendOptions(kind, set));
    }
    return details;
  }

  private field(set: HTMLElement, tag: 'select' | 'input', label: string): HTMLElement {
    const doc = set.ownerDocument;
    const wrap = set.appendChild(doc.createElement('label'));
    wrap.className = styles.field!;
    wrap.append(label);
    return wrap.appendChild(doc.createElement(tag));
  }

  private sendOptions(kind: NoteKind, set: HTMLElement): void {
    const value = (field: string) =>
      (set.querySelector(`[data-field="${field}"]`) as HTMLInputElement | HTMLSelectElement).value;
    const start = Number.parseInt(value('start'), 10);
    const before = this.deps.model.settings()[kind];
    const next: NoteSettings = {
      format: value('format') as NoteSettings['format'],
      start: Number.isInteger(start) && start >= 0 ? Math.min(start, MAX_NOTE_START) : before.start,
      restart: value('restart') as NoteSettings['restart'],
    };
    this.deps.sendSettings(kind, next);
  }

  private syncOptions(): void {
    const settings: NotesSettings = this.deps.model.settings();
    for (const set of this.options.querySelectorAll<HTMLElement>('fieldset')) {
      const kind = set.dataset.kind as NoteKind;
      for (const field of ['format', 'start', 'restart'] as const) {
        const input = set.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`)!;
        const value = String(settings[kind][field]);
        if (input.value !== value && input.ownerDocument.activeElement !== input) input.value = value;
      }
    }
  }

  private readonly onDoubleClick = (event: MouseEvent) => {
    const ref = (event.target as Element | null)?.closest?.('[data-footnote]');
    const id = ref?.getAttribute('data-footnote');
    if (!id || !this.items.has(id)) return;
    event.preventDefault();
    this.focusNote(id);
  };
}

export function createNotesView(deps: NotesViewDeps): NotesView {
  return new View(deps);
}
