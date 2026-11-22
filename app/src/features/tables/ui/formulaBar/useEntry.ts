// The formula bar entry's state: the draft being typed (its text, caret, and the cell it writes to), the
// autocomplete list and the argument hint at the caret, and the keys that act on them. While a draft is open, the
// grid outlines its references and a click on the grid adds a reference to it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { t } from '../../../../strings/t';
import type { TableExtraHost } from '../../../page';
import { accept, complete, hintAt } from './complete';
import type { Completion, Hint } from './complete';
import { completeContext, pageTables } from './page';
import { canPick, cycleAnchor, insertRef } from './refs';
import { setBarPicker, showBarFormula } from './refsPlugin';
import { commitEntry } from './sync';
import type { Active } from './sync';

export interface Draft {
  text: string;
  caret: number;
  /** The cell the entry writes to: the active cell when the entry began. */
  cell: Active;
  /** The span the last pick from the grid wrote, so a drag replaces it. */
  picked?: { start: number; end: number };
}

export type Finish = 'down' | 'right' | 'stay' | 'cancel';

export interface Entry {
  draft: Draft | null;
  text: string;
  caret: number;
  completion: Completion | null;
  hint: Hint | null;
  selected: number;
  /** Shows a new draft. `typed` is true when typing in the entry made it, so the caret stays where typing put it. */
  update(next: Draft, typed?: boolean): void;
  begin(): void;
  finish(how: Finish): void;
  choose(index: number): void;
  moveCaret(at: number): void;
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
}

/** The draft, kept in a ref too, so the grid's picker and the key handlers read the newest one. */
function useDraft(host: TableExtraHost, field: RefObject<HTMLTextAreaElement | null>) {
  const view = host.editor.view;
  const [draft, setDraft] = useState<Draft | null>(null);
  const ref = useRef<Draft | null>(null);
  /** Where the caret goes once the text a change wrote shows. Typing places its own caret, so it leaves this null. */
  const place = useRef<number | null>(null);
  useLayoutEffect(() => {
    ref.current = draft;
    if (place.current !== null) field.current?.setSelectionRange(place.current, place.current);
    place.current = null;
  });
  const update = useCallback(
    (next: Draft, typed = false) => {
      ref.current = next;
      place.current = typed ? null : next.caret;
      setDraft(next);
      showBarFormula(view, next.text);
    },
    [view],
  );
  /** Ends the entry: writes it and moves, writes it and stays (focus went elsewhere), or puts the cell back. */
  const finish = (how: Finish) => {
    const now = ref.current;
    ref.current = null;
    setDraft(null);
    showBarFormula(view, null);
    if (now && how !== 'cancel') commitEntry(view, now.cell.at, now.text, how);
    if (how !== 'stay') view.focus();
  };
  return { draft, setDraft, ref, update, finish };
}

/** While a draft is open, lends the grid a picker that adds the clicked cell or range to the draft. */
function usePicker(
  host: TableExtraHost,
  drafting: boolean,
  ref: RefObject<Draft | null>,
  update: (next: Draft) => void,
) {
  const view = host.editor.view;
  useEffect(() => {
    if (!drafting) return;
    setBarPicker(view, {
      canPick: () => {
        const now = ref.current;
        return now !== null && (now.picked !== undefined || canPick(now.text, now.caret));
      },
      pick: (cells, first) => {
        const now = ref.current;
        if (!now) return;
        const done = insertRef(now.text, now.caret, cells, first && !now.picked ? undefined : now.picked);
        update({ ...now, text: done.text, caret: done.caret, picked: done.picked });
        host.announce(t('sheetFormula.bar.picked', { ref: cells }));
      },
    });
    return () => setBarPicker(view, null);
  }, [drafting, view, update, host, ref]);
}

interface KeyContext {
  entry: Omit<Entry, 'onKeyDown'>;
  close(): void;
  move(by: 1 | -1): void;
  insertFunction(): void;
}

/** Keys of the open autocomplete list: arrows move, Tab accepts, Esc closes it. True when the key was used. */
function listKeys(event: KeyboardEvent<HTMLTextAreaElement>, ctx: KeyContext): boolean {
  if (!ctx.entry.completion) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') ctx.move(event.key === 'ArrowDown' ? 1 : -1);
  else if (event.key === 'Tab' && !event.shiftKey) ctx.entry.choose(ctx.entry.selected);
  else if (event.key === 'Escape') ctx.close();
  else return false;
  return true;
}

/** Keys of the entry: Enter, Tab, Esc, Alt+Enter, F4, and Shift+F3. True when the key was used. */
function entryKeys(event: KeyboardEvent<HTMLTextAreaElement>, ctx: KeyContext): boolean {
  const { entry } = ctx;
  const draft = entry.draft;
  if (event.key === 'Escape') entry.finish('cancel');
  else if (event.key === 'Enter' && event.altKey && draft) {
    const at = entry.caret;
    entry.update({ ...draft, text: `${draft.text.slice(0, at)}\n${draft.text.slice(at)}`, caret: at + 1 });
  } else if (event.key === 'Enter' || event.key === 'Tab') entry.finish(event.key === 'Enter' ? 'down' : 'right');
  else if (event.key === 'F4' && draft) {
    const cycled = cycleAnchor(draft.text, event.currentTarget.selectionStart);
    if (cycled) entry.update({ ...draft, text: cycled.text, caret: cycled.caret });
  } else if (event.key === 'F3' && event.shiftKey) ctx.insertFunction();
  else return false;
  return true;
}

/** The entry of the bar for the active cell. `insertFunction` opens the Insert function dialog (Shift+F3). */
export function useEntry(
  host: TableExtraHost,
  active: Active | null,
  field: RefObject<HTMLTextAreaElement | null>,
  insertFunction: () => void,
): Entry {
  const { draft, setDraft, ref, update: write, finish } = useDraft(host, field);
  const [selected, setSelected] = useState(0);
  const [closed, setClosed] = useState(false);
  const drafting = draft !== null;
  const page = useMemo(() => (drafting ? pageTables(host) : null), [host, drafting]);
  const update = useCallback(
    (next: Draft, typed = false) => {
      setClosed(false);
      setSelected(0);
      write(next, typed);
    },
    [write],
  );
  usePicker(host, drafting, ref, update);
  const text = draft?.text ?? active?.text ?? '';
  const caret = draft?.caret ?? text.length;
  const completion = draft && !closed ? complete(text, caret, completeContext(page)) : null;
  const entry: Omit<Entry, 'onKeyDown'> = {
    ...{ draft, text, caret, completion, selected, update, finish },
    hint: draft && !completion ? hintAt(text, caret) : null,
    begin: () => {
      if (draft || !active) return;
      update({ text: active.text, caret: field.current?.selectionStart ?? active.text.length, cell: active }, true);
    },
    choose: (index) => {
      const item = completion?.items[index];
      if (completion && item && draft) update({ ...draft, ...accept(draft.text, completion, item) });
    },
    moveCaret: (at) => {
      if (draft && at !== draft.caret) setDraft({ ...draft, caret: at, picked: undefined });
    },
  };
  const n = completion?.items.length ?? 1;
  const ctx: KeyContext = {
    entry,
    close: () => setClosed(true),
    move: (by) => setSelected((s) => (s + by + n) % n),
    insertFunction,
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (listKeys(event, ctx) || entryKeys(event, ctx)) event.preventDefault();
  };
  return { ...entry, onKeyDown };
}
