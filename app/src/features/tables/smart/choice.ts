// What a choice column does with text (Further features, Phase 7), apart from any editor so tests run it directly.
// A cell keeps the names of its options as plain text. Picking, renaming, and removing an option are edits of that
// text, and the display reads the same text back to find each option's color. See docs/adr/0048-choice-columns.md.
import { MAX_CHOICES, choiceIndex, cleanChoiceName, joinChoices, splitChoices } from '../engine';
import { CHOICE_COLORS } from './data';
import type { ChoiceColor, ChoiceOption, ColumnSmart, SmartData } from './data';

/** A choice column's options and whether a cell may hold several. Null for any other column. */
export interface ChoiceInfo {
  options: readonly ChoiceOption[];
  multi: boolean;
}

export function choiceOf(smart: SmartData, columnId: string): ChoiceInfo | null {
  const own: ColumnSmart | undefined = smart.columns[columnId];
  return own?.type === 'choice' ? { options: own.options ?? [], multi: own.multi === true } : null;
}

/** The names a cell holds. A column that takes one option reads the whole text as that one name. */
export function namesIn(text: string, multi: boolean): string[] {
  if (multi) return splitChoices(text);
  const name = text.trim();
  return name === '' ? [] : [name];
}

/** Each name in a cell with the option it is, or null for text that no option has. */
export function readCell(info: ChoiceInfo, text: string): { name: string; option: ChoiceOption | null }[] {
  return namesIn(text, info.multi).map((name) => {
    const at = choiceIndex(
      info.options.map((option) => option.name),
      name,
    );
    return { name, option: at < 0 ? null : info.options[at] };
  });
}

/** The cell text after picking `name`: it replaces the value for one option, and is added or taken away for several. */
export function pick(info: ChoiceInfo, text: string, name: string): string {
  const names = namesIn(text, info.multi);
  const has = names.some((one) => one.toLowerCase() === name.toLowerCase());
  if (!info.multi) return has ? '' : name;
  const kept = has ? names.filter((one) => one.toLowerCase() !== name.toLowerCase()) : [...names, name];
  // Names go in the order of the options, so the same picks always write the same text.
  const place = (one: string) => {
    const at = choiceIndex(
      info.options.map((option) => option.name),
      one,
    );
    return at < 0 ? info.options.length : at;
  };
  return joinChoices([...kept].sort((a, b) => place(a) - place(b)));
}

/** Whether a cell has the option picked. */
export const isPicked = (info: ChoiceInfo, text: string, name: string): boolean =>
  namesIn(text, info.multi).some((one) => one.toLowerCase() === name.toLowerCase());

/** The cell text with each name changed by `change`: a new name, or null to take that name out. */
export function rewrite(info: ChoiceInfo, text: string, change: (name: string) => string | null): string {
  const out: string[] = [];
  for (const name of namesIn(text, info.multi)) {
    const next = change(name);
    if (next !== null && !out.some((one) => one.toLowerCase() === next.toLowerCase())) out.push(next);
  }
  return info.multi ? joinChoices(out) : (out[0] ?? '');
}

/** An option being edited: `was` is the name it had when the editor opened, so a rename can reach the cells. */
export interface Draft {
  name: string;
  color: ChoiceColor;
  was?: string;
}

/** The color a new option gets: the first one the others use least. */
export function nextColor(used: readonly ChoiceColor[]): ChoiceColor {
  const counts = CHOICE_COLORS.map((color) => used.filter((one) => one === color).length);
  return CHOICE_COLORS[counts.indexOf(Math.min(...counts))];
}

export type DraftProblem = { kind: 'empty' } | { kind: 'taken'; name: string } | { kind: 'many' };

/** What is wrong with the edited options, or null. Names are unique without regard to case. */
export function draftProblem(drafts: readonly Draft[]): DraftProblem | null {
  if (drafts.length > MAX_CHOICES) return { kind: 'many' };
  const seen = new Set<string>();
  for (const draft of drafts) {
    const name = cleanChoiceName(draft.name);
    if (name === '') return { kind: 'empty' };
    if (seen.has(name.toLowerCase())) return { kind: 'taken', name };
    seen.add(name.toLowerCase());
  }
  return null;
}

/** The options an editor's drafts make. */
export const optionsOfDrafts = (drafts: readonly Draft[]): ChoiceOption[] =>
  drafts.map((draft) => ({ name: cleanChoiceName(draft.name), color: draft.color }));

/** The renames the drafts make, as old name to new name, for the cells that hold the old one. */
export function renamesOf(drafts: readonly Draft[]): Map<string, string> {
  const renames = new Map<string, string>();
  for (const draft of drafts) {
    const name = cleanChoiceName(draft.name);
    if (draft.was !== undefined && draft.was !== name) {
      renames.set(draft.was.toLowerCase(), name);
    }
  }
  return renames;
}

/**
 * Options for a column that becomes a choice column: the distinct names its cells already hold, in the order they
 * appear, so changing a column of "Done" and "Reading" to a choice keeps every value.
 */
export function optionsFromCells(cells: readonly string[], multi: boolean): ChoiceOption[] {
  const found: string[] = [];
  for (const text of cells) {
    for (const raw of multi ? splitChoices(text) : [text.trim()]) {
      const name = cleanChoiceName(raw);
      if (name !== '' && !found.some((one) => one.toLowerCase() === name.toLowerCase())) found.push(name);
    }
  }
  return found.slice(0, MAX_CHOICES).map((name, i) => ({ name, color: CHOICE_COLORS[i % CHOICE_COLORS.length] }));
}
