// Footnotes and endnotes (text program, Beta 12; ADR 0087), behind text.footnotes. Each page view gets a notes
// model, the notes area under its text, and a text rider, so a reference and its note always change in one undo
// step. The commands insert a reference, go between a reference and its note, and convert notes.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { isEnabled } from '../../../app/flags';
import { parseTextBlock } from '../../../editor/markdown';
import { caretAfterRef, conversionPatches, insertNote, refAtCaret } from '../../../editor/notes/commands';
import { NotesModel } from '../../../editor/notes/model';
import type { NotesPatch } from '../../../editor/notes/model';
import { readNotes } from '../../../editor/notes/refs';
import type { NoteKind } from '../../../editor/notes/refs';
import { createNotesView } from '../../../editor/notes/view';
import type { NotesView, NotesViewDeps } from '../../../editor/notes/view';
import type { AppliedFrame, BlockJson, EditBatch } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { liveText } from '../blocks/textBlock';
import { targetEditor } from '../formattingBar/target';
import { mountedPageHooks, shownMounted } from '../pagesApi';
import type { MountedPage } from '../pagesApi';
import { addTextRider } from '../sync/textSync';
import { addCommand } from './qolStudy';
import { say } from './say';

export interface PageNotes {
  model: NotesModel;
  view: NotesView;
  detach(): void;
}

const attached = new WeakMap<MountedPage, PageNotes>();

/** The notes of a page view, once attached. Tests and commands read it. */
export function pageNotes(mounted: MountedPage): PageNotes | null {
  return attached.get(mounted) ?? null;
}

const isText = (block: BlockJson) => block.type === 'text';

/** Keeps the model's blocks in step with the layer's text blocks: new ones are read, gone ones are removed. */
function blockReader(layer: MountedPage['layer'], model: NotesModel): () => void {
  const known = new Set<string>();
  return () => {
    const now = new Set(
      layer
        .blocks()
        .filter(isText)
        .map((block) => block.id),
    );
    for (const block of layer.blocks().filter((one) => isText(one) && !known.has(one.id))) {
      known.add(block.id);
      model.setBlock(block.id, readNotes(block.data));
    }
    for (const id of [...known].filter((one) => !now.has(one))) {
      known.delete(id);
      model.removeBlock(id);
    }
  };
}

/** The page's text blocks in reading order, with the documents they show. */
function shownDocs(layer: MountedPage['layer']): { id: string; doc: PMNode }[] {
  return layer
    .blocks()
    .filter(isText)
    .map((block) => ({
      id: block.id,
      doc: liveText(layer.view(block.id))?.liveDoc() ?? parseTextBlock(String(block.data.markdown ?? '')),
    }));
}

function viewDeps(mounted: MountedPage, model: NotesModel): NotesViewDeps {
  const { layer, page, sync, pool } = mounted;
  const send = (batch: EditBatch) => void sync.send(batch).catch(() => undefined);
  const notesEdit = (block: string, patch: NotesPatch) => ({
    edit: 'patchBlock' as const,
    block,
    data: { notes: patch },
  });
  return {
    model,
    after: mounted.flow.element,
    root: mounted.viewport.world,
    host: mounted.host,
    readOnly: page.readOnly !== null,
    blocks: () => shownDocs(layer),
    sendNotes(block, patch, typing) {
      model.apply(block, patch);
      const coalesce = typing ? { coalesce: { kind: 'typing' as const, target: typing } } : {};
      send({ edits: [notesEdit(block, patch)], ...coalesce });
    },
    sendSettings(kind, settings) {
      const notes = { [kind]: settings };
      model.setView({ text: { notes: { ...model.settings(), ...notes } } });
      send({ edits: [{ edit: 'setPage', view: { text: { notes } } }] });
    },
    showRef(block, id) {
      const editor = pool.mount(block, null, 'target') ?? pool.editor(block);
      if (editor) caretAfterRef(editor, id);
    },
  };
}

/** What a frame from the core (an undo, a redo, another window) changes in the notes. */
function applyFrame(model: NotesModel, applied: AppliedFrame): void {
  for (const block of applied.blocks.filter(isText)) model.setBlock(block.id, readNotes(block.data));
  for (const id of applied.removed) model.removeBlock(id);
  if (applied.page?.view) model.setView(applied.page.view);
}

/** Gives a page view its notes model, notes area, and rider. Returns a function that takes them away again. */
export function attachNotes(mounted: MountedPage): PageNotes {
  const { layer, page, sync } = mounted;
  const model = new NotesModel();
  model.setView(page.initial.view);
  const readBlocks = blockReader(layer, model);
  readBlocks();
  const view = createNotesView(viewDeps(mounted, model));
  const frame = (applied: AppliedFrame) => {
    applyFrame(model, applied);
    view.refresh();
  };
  const rider = (block: string, before: string, after: string) => {
    if (!layer.block(block)) return [];
    // A reference that moved inside its block changes no note, but it can change the numbers.
    if (before.includes('[^') || after.includes('[^')) view.refresh();
    return model.rider(block, before, after);
  };
  const stops = [
    layer.onChange(() => {
      readBlocks();
      view.refresh();
    }),
    sync.onStep(frame),
    page.onFrame(frame),
    addTextRider(rider),
  ];
  const notes: PageNotes = {
    model,
    view,
    detach() {
      stops.forEach((stop) => stop());
      view.destroy();
      attached.delete(mounted);
    },
  };
  attached.set(mounted, notes);
  return notes;
}

mountedPageHooks.register({
  id: 'text.notes',
  attach: (mounted) => (isEnabled('text.footnotes') ? attachNotes(mounted).detach : () => undefined),
});

/** The shown page's notes and the editor with the caret, if any. */
function shown(): { notes: PageNotes; mounted: MountedPage; editor: Editor | null } | null {
  const mounted = shownMounted.get();
  const notes = mounted ? pageNotes(mounted) : null;
  return mounted && notes ? { notes, mounted, editor: targetEditor() } : null;
}

function insert(kind: NoteKind): void {
  const found = shown();
  if (!found?.editor) return say(t('textNotes.needsText'));
  const id = insertNote(found.editor, found.notes.model, kind);
  if (!id) return say(t('textNotes.cannotHere'));
  found.notes.view.refreshNow();
  found.notes.view.focusNote(id);
}

/** The note the person is on: the one whose text has the focus, or the reference at the caret. */
function noteHere(found: NonNullable<ReturnType<typeof shown>>): string | null {
  return found.notes.view.focusedNote() ?? (found.editor ? refAtCaret(found.editor) : null);
}

function goTo(): void {
  const found = shown();
  if (!found) return say(t('textNotes.needsText'));
  const inNote = found.notes.view.focusedNote();
  if (inNote) {
    const note = found.notes.view.numbering().byId.get(inNote);
    const editor = note ? (found.mounted.pool.mount(note.block, null, 'target') ?? null) : null;
    if (note && editor) caretAfterRef(editor, note.id);
    return;
  }
  const id = found.editor ? refAtCaret(found.editor) : null;
  if (!id || !found.notes.view.focusNote(id)) say(t('textNotes.noNoteHere'));
}

function convert(from: NoteKind | null, only: string | null): void {
  const found = shown();
  if (!found) return say(t('textNotes.noNotes'));
  const patches = conversionPatches(found.notes.model, from, only);
  if (patches.size === 0) return say(t(only === null ? 'textNotes.noNotes' : 'textNotes.noNoteHere'));
  const edits = [...patches].map(([block, patch]: [string, NotesPatch]) => {
    found.notes.model.apply(block, patch);
    return { edit: 'patchBlock' as const, block, data: { notes: patch } };
  });
  void found.mounted.sync.send({ edits }).catch(() => undefined);
  const count = [...patches.values()].reduce((sum, patch) => sum + Object.keys(patch).length, 0);
  found.mounted.host.announce(t('textNotes.converted', { count }));
}

addCommand({
  id: 'text.notes.footnote',
  title: 'textNotes.insertFootnote',
  keywords: 'textNotes.insertFootnoteKeywords',
  icon: 'TextSuperscript',
  flag: 'text.footnotes',
  slash: { group: 'advanced', order: 60 },
  bar: { group: 'footnote', priority: 50 },
  run: () => insert('foot'),
});
addCommand({
  id: 'text.notes.endnote',
  title: 'textNotes.insertEndnote',
  keywords: 'textNotes.insertEndnoteKeywords',
  icon: 'TextSuperscript',
  flag: 'text.footnotes',
  slash: { group: 'advanced', order: 61 },
  bar: { group: 'endnote', priority: 50 },
  run: () => insert('end'),
});
addCommand({
  id: 'text.notes.goTo',
  title: 'textNotes.goTo',
  keywords: 'textNotes.goToKeywords',
  icon: 'ArrowsDownUp',
  flag: 'text.footnotes',
  category: 'editing',
  run: goTo,
});
for (const [id, title, from] of [
  ['text.notes.toEndnotes', 'textNotes.toEndnotes', 'foot'],
  ['text.notes.toFootnotes', 'textNotes.toFootnotes', 'end'],
] as const) {
  addCommand({
    id,
    title,
    keywords: 'textNotes.convertKeywords',
    icon: 'ArrowsLeftRight',
    flag: 'text.footnotes',
    category: 'editing',
    run: () => convert(from, null),
  });
}
addCommand({
  id: 'text.notes.convertOne',
  title: 'textNotes.convertOne',
  keywords: 'textNotes.convertKeywords',
  icon: 'ArrowsLeftRight',
  flag: 'text.footnotes',
  category: 'editing',
  run: () => {
    const found = shown();
    const id = found ? noteHere(found) : null;
    if (!id) return say(t('textNotes.noNoteHere'));
    convert(null, id);
  },
});
