// Answers Zotero's calls against the text block that is being edited (Citation helper). One integration command is
// one conversation: it starts with Application_getActiveDocument, ends with Document_complete, and in between Zotero
// inserts fields, sets their codes and their text, and reads them back. The bridge keeps the field numbers Zotero is
// given steady for the conversation, and never touches anything that is not a Zotero field.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TEMP_CODE, hrefFor, isBibliographyCode, listFields } from './fields';
import type { Field } from './fields';
import { plainParagraphs, richParagraphs } from './html';
import type { Paragraph } from './html';

/** The document id given to Zotero: there is one document per conversation. */
export const DOCUMENT_ID = 'opennote';
/** The text a new citation holds until Zotero writes the real one. */
export const PLACEHOLDER = '{Citation}';
const BIBLIOGRAPHY_PLACEHOLDER = '{Bibliography}';

/** What the bridge needs of the page and the person. */
export interface Host {
  state(): EditorState;
  dispatch(transaction: Transaction): void;
  /** Zotero's message. Answers with the button, as Zotero numbers them: OK is 1; Yes is 1 and No is 0; Cancel is 0. */
  alert(text: string, icon: number, buttons: number): Promise<number>;
  activate?(): void;
}

/** Zotero's document preferences (citation style and so on): an opaque string kept with the notebook. */
export interface Prefs {
  get(): string;
  set(data: string): void;
}

const text = (args: readonly unknown[], index: number): string => {
  const one = args[index];
  return typeof one === 'string' ? one : one === null || one === undefined ? '' : String(one);
};
const whole = (args: readonly unknown[], index: number): number => {
  const one = Number(args[index]);
  return Number.isFinite(one) ? Math.trunc(one) : 0;
};

export class ZoteroBridge {
  /** The address of each field Zotero knows, by its number minus one. */
  private readonly hrefs: string[] = [];
  private nonce = 0;
  private begun: number | null = null;
  private justInserted: string | null = null;
  private selected = false;
  /** Zotero finished the conversation. */
  completed = false;

  constructor(
    private readonly host: Host,
    private readonly prefs: Prefs,
  ) {}

  /** The page changed by this conversation, for the caller to tidy up after an abandoned one. */
  leftovers(): Field[] {
    return listFields(this.host.state().doc).filter((one) => one.code.startsWith(TEMP_CODE));
  }

  /** Removes fields Zotero never gave a code (a conversation that was canceled half-way). */
  sweep(): void {
    const left = this.leftovers().reverse();
    if (left.length === 0) return;
    const tr = this.host.state().tr;
    for (const one of left) tr.delete(one.from, one.to);
    this.host.dispatch(tr);
  }

  async handle(method: string, args: readonly unknown[]): Promise<unknown> {
    switch (method) {
      case 'Application_getActiveDocument': {
        this.begun = this.host.state().selection.from;
        this.justInserted = null;
        this.selected = false;
        this.completed = false;
        // What the page can do, as Zotero's HTTP integration asks (no notes: a page has no footnotes).
        return {
          documentID: DOCUMENT_ID,
          outputFormat: 'html',
          supportedNotes: [],
          supportsImportExport: false,
          supportsTextInsertion: false,
          supportsCitationMerging: false,
          processorName: 'OpenNote',
        };
      }
      case 'Document_displayAlert':
        return this.host.alert(text(args, 1), whole(args, 2), whole(args, 3));
      case 'Document_activate':
        this.host.activate?.();
        return null;
      case 'Document_canInsertField':
        return this.canInsert();
      case 'Document_getDocumentData':
        return this.prefs.get();
      case 'Document_setDocumentData':
        this.prefs.set(text(args, 1));
        return null;
      case 'Document_cursorInField':
        return this.cursorInField();
      case 'Document_insertField':
        return this.insertField();
      case 'Document_insertText':
        this.insertText(text(args, 1));
        return null;
      case 'Document_getFields': {
        const all = listFields(this.host.state().doc);
        return all.map((one) => this.fieldJson(one));
      }
      // Footnotes and endnotes do not exist on a page: every citation stays in the text.
      case 'Document_convert':
      case 'Field_convert':
      case 'Document_setBibliographyStyle':
        return null;
      case 'Document_complete':
        this.complete();
        return null;
      case 'Field_delete':
        this.remove(this.field(args), false);
        return null;
      case 'Field_removeCode':
        this.remove(this.field(args), true);
        return null;
      case 'Field_select': {
        const one = this.field(args);
        const state = this.host.state();
        this.host.dispatch(state.tr.setSelection(TextSelection.create(state.doc, one.from, one.to)));
        this.selected = true;
        return null;
      }
      case 'Field_getText':
        return this.host.state().doc.textBetween(this.field(args).from, this.field(args).to, '\n', ' ');
      case 'Field_getCode':
        return this.field(args).code;
      case 'Field_setCode':
        this.setCode(this.field(args), text(args, 2));
        return null;
      case 'Field_setText':
        this.setText(this.field(args), text(args, 2), args[3] === true || args[3] === 1 || args[3] === 'true');
        return null;
      default:
        throw new Error(`OpenNote does not support ${method}`);
    }
  }

  private idFor(href: string): number {
    const known = this.hrefs.indexOf(href);
    if (known >= 0) return known + 1;
    this.hrefs.push(href);
    return this.hrefs.length;
  }

  /** A field as Zotero's HTTP integration reads it. */
  private fieldJson(one: Field): { id: number; code: string; text: string; noteIndex: number } {
    const text = this.host.state().doc.textBetween(one.from, one.to, '\n', ' ');
    return { id: this.idFor(one.href), code: one.code, text, noteIndex: 0 };
  }

  private field(args: readonly unknown[]): Field {
    const id = whole(args, 1);
    const href = this.hrefs[id - 1];
    const found = href === undefined ? undefined : listFields(this.host.state().doc).find((one) => one.href === href);
    if (!found) throw new Error(`no field with number ${id}`);
    return found;
  }

  private canInsert(): boolean {
    const { selection, schema } = this.host.state();
    return selection.$from.parent.inlineContent && selection.$from.parent.type.allowsMarkType(schema.marks.link);
  }

  private cursorInField(): unknown {
    const state = this.host.state();
    const { from, to, empty } = state.selection;
    const hit = listFields(state.doc).find((one) =>
      empty ? from > one.from && from < one.to : from >= one.from && to <= one.to,
    );
    return hit ? this.fieldJson(hit) : null;
  }

  private insertField(): unknown {
    if (!this.canInsert()) throw new Error('A citation cannot go here. Click in the text of a page first.');
    const state = this.host.state();
    const { schema } = state;
    const code = `${TEMP_CODE}${(this.nonce += 1)}.${Date.now().toString(36)}`;
    const href = hrefFor(code);
    const { from, to } = state.selection;
    const tr = state.tr.replaceWith(from, to, schema.text(PLACEHOLDER, [schema.marks.link.create({ href })]));
    this.host.dispatch(tr);
    this.justInserted = href;
    return { id: this.idFor(href), code, text: PLACEHOLDER, noteIndex: 0 };
  }

  private insertText(html: string): void {
    const state = this.host.state();
    const paragraph = richParagraphs(html)[0] ?? [];
    const { from, to } = state.selection;
    this.host.dispatch(state.tr.replaceWith(from, to, this.inline(state, paragraph, null)));
  }

  private inline(state: EditorState, paragraph: Paragraph, href: string | null): PMNode[] {
    const { schema } = state;
    return paragraph
      .filter((piece) => piece.text !== '')
      .map((piece) => {
        const marks = piece.formats.flatMap((format) => {
          const type = schema.marks[format] as (typeof schema.marks)[string] | undefined;
          return type ? [type.create()] : [];
        });
        if (href !== null) marks.push(schema.marks.link.create({ href }));
        return schema.text(piece.text, marks);
      });
  }

  private setCode(one: Field, code: string): void {
    const state = this.host.state();
    const link = state.schema.marks.link;
    const href = hrefFor(code);
    const tr = state.tr.removeMark(one.from, one.to, link).addMark(one.from, one.to, link.create({ href }));
    this.host.dispatch(tr);
    this.hrefs[this.hrefs.indexOf(one.href)] = href;
    if (this.justInserted === one.href) this.justInserted = href;
  }

  private setText(one: Field, value: string, rich: boolean): void {
    const state = this.host.state();
    const paragraphs = rich ? richParagraphs(value) : plainParagraphs(value);
    if (isBibliographyCode(one.code)) return this.setBibliography(state, one, paragraphs);
    const nodes: PMNode[] = [];
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) nodes.push(state.schema.text(' ', [state.schema.marks.link.create({ href: one.href })]));
      nodes.push(...this.inline(state, paragraph, one.href));
    });
    if (nodes.length === 0) {
      nodes.push(state.schema.text(PLACEHOLDER, [state.schema.marks.link.create({ href: one.href })]));
    }
    this.host.dispatch(state.tr.replaceWith(one.from, one.to, nodes));
  }

  /** A bibliography is a paragraph for each entry, or one paragraph with line breaks where a paragraph cannot go. */
  private setBibliography(state: EditorState, one: Field, paragraphs: readonly Paragraph[]): void {
    const { schema } = state;
    const entries: readonly Paragraph[] =
      paragraphs.length > 0 ? paragraphs : [[{ text: BIBLIOGRAPHY_PLACEHOLDER, formats: [] }]];
    const blocks = entries.map((entry) => schema.nodes.paragraph.create(null, this.inline(state, entry, one.href)));
    const tr = state.tr;
    if (one.block) return this.host.dispatch(tr.replaceWith(one.from, one.to, blocks));

    // A new field is a run of text inside a paragraph. The entries go in its place if it is the whole paragraph,
    // and after the paragraph if there is more in it.
    const $from = state.doc.resolve(one.from);
    const container = $from.node($from.depth - 1);
    const index = $from.index($from.depth - 1);
    const alone = $from.parent.content.size === one.to - one.from;
    const fits = alone
      ? container.canReplace(index, index + 1, Fragment.from(blocks))
      : container.canReplace(index + 1, index + 1, Fragment.from(blocks));
    if (!fits) {
      const lines: PMNode[] = [];
      entries.forEach((entry, at) => {
        if (at > 0) lines.push(schema.nodes.hardBreak.create());
        lines.push(...this.inline(state, entry, one.href));
      });
      return this.host.dispatch(tr.replaceWith(one.from, one.to, lines));
    }
    if (alone) tr.replaceWith($from.before(), $from.after(), blocks);
    else tr.delete(one.from, one.to).insert(tr.mapping.map($from.after()), blocks);
    this.host.dispatch(tr);
  }

  private remove(one: Field, keepText: boolean): void {
    const state = this.host.state();
    const tr = keepText
      ? state.tr.removeMark(one.from, one.to, state.schema.marks.link)
      : state.tr.delete(one.from, one.to);
    this.host.dispatch(tr);
  }

  private complete(): void {
    const state = this.host.state();
    const placed =
      this.justInserted === null ? undefined : listFields(state.doc).find((one) => one.href === this.justInserted);
    const clamp = (at: number) => Math.max(0, Math.min(at, state.doc.content.size));
    if (placed) {
      this.host.dispatch(
        state.tr.setSelection(TextSelection.near(state.doc.resolve(clamp(placed.to)), -1)).scrollIntoView(),
      );
    } else if (this.selected && this.begun !== null) {
      this.host.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(clamp(this.begun)))));
    }
    this.justInserted = null;
    this.selected = false;
    this.completed = true;
  }
}
