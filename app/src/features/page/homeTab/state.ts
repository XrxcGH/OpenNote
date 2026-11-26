// What the Home tab's controls read from the selection: the font and size boxes (blank when the selection mixes
// values), a toggle's pressed state (true, false, or 'mixed'), and the current colors. Pure functions of the editor
// state, so a test can check them without a page. Owner: text:home-tab-ui (B10).
import type { Mark } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { pointsOf, BODY_POINTS } from '../../../editor/commands/sizes';
import { runMarkPressed } from '../../../editor/commands/runFormat';

const marksAtSelection = (state: EditorState): readonly Mark[] => state.storedMarks ?? state.selection.$from.marks();

/** The marks on each text run of the selection, or the caret's marks when it is empty. */
function runsOf(state: EditorState): (readonly Mark[])[] {
  const { selection } = state;
  if (selection.empty) return [marksAtSelection(state)];
  const runs: (readonly Mark[])[] = [];
  for (const range of selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (node.isText) runs.push(node.marks);
      return true;
    });
  }
  return runs.length > 0 ? runs : [marksAtSelection(state)];
}

/** The value of one attribute of one mark over the selection: a string, null when none has it, 'mixed' when they differ. */
export function runValue(state: EditorState, mark: string, attr: string): string | null | 'mixed' {
  const values = new Set<string | null>();
  for (const marks of runsOf(state)) {
    const found = marks.find((candidate) => candidate.type.name === mark);
    const value = found?.attrs[attr];
    values.add(typeof value === 'string' ? value : null);
    if (values.size > 1) return 'mixed';
  }
  return [...values][0] ?? null;
}

/** The font of the selection for the font box: the name, a theme token, or null when mixed (a blank box). */
export function fontAt(state: EditorState): { value: string | null; mixed: boolean } {
  const value = runValue(state, 'font', 'font');
  return value === 'mixed' ? { value: null, mixed: true } : { value, mixed: false };
}

/** The size in points for the size box, or null when the selection mixes sizes (a blank box). */
export function sizeAt(state: EditorState): { points: number | null; mixed: boolean } {
  const value = runValue(state, 'textSize', 'size');
  if (value === 'mixed') return { points: null, mixed: true };
  return { points: pointsOf(value, BODY_POINTS), mixed: false };
}

/** A toggle's `aria-pressed`: true, false, or 'mixed'. */
export function pressedAt(state: EditorState, mark: string): boolean | 'mixed' {
  return runMarkPressed(state, mark);
}

/** The last colors picked from the Home tab. A main button applies its color again, as Word does. */
const lastPicked: { textColor: string; highlight: string } = { textColor: 'theme:accent1', highlight: 'honey' };
export const lastColor = (mark: 'textColor' | 'highlight'): string => lastPicked[mark];
export function rememberColor(mark: 'textColor' | 'highlight', color: string | null): void {
  if (color === 'none') return;
  lastPicked[mark] = color ?? 'honey';
}

/** The color a color mark has over the selection, or null (none, or mixed). */
export function colorAt(state: EditorState, mark: 'textColor' | 'highlight'): string | null {
  const value = runValue(state, mark, 'color');
  return value === 'mixed' ? null : value;
}

/** What the bar shows for the selection: the stored marks, the marks at both ends, and the paragraph's attributes. */
export function formatKey(state: EditorState | undefined): string {
  if (!state) return '';
  const { $from, $to } = state.selection;
  const marks = (list: readonly Mark[] | null) => (list ?? []).map((mark) => [mark.type.name, mark.attrs]);
  return JSON.stringify([
    marks(state.storedMarks),
    marks($from.marks()),
    marks($to.marks()),
    state.selection.empty,
    $from.parent.type.name,
    $from.parent.attrs,
    $to.parent.attrs,
  ]);
}
