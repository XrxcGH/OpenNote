// Speak formatting at the caret (owner: text:editor-commands; text DESIGN.md 4.1 and 10): one sentence for people
// who cannot see the toolbar state, such as "Georgia, 13 points, bold, Brick, Heading 2, Centered". The editor's host
// reads it through its live region.
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { hostOf } from '../extensions/keys';
import { PEN_COLORS } from '../schema/constants';
import { paraAt } from './paragraph';
import { pointsOf } from './sizes';

function marksAt(state: EditorState): readonly Mark[] {
  const { selection } = state;
  if (selection.empty) return state.storedMarks ?? selection.$from.marks();
  return selection.$from.nodeAfter?.marks ?? selection.$from.marks();
}

const PLAIN: Readonly<Record<string, MessageKey>> = {
  bold: 'textCommands.speak.bold',
  italic: 'textCommands.speak.italic',
  subscript: 'textCommands.speak.subscript',
  superscript: 'textCommands.speak.superscript',
  code: 'textCommands.speak.code',
  highlight: 'textCommands.speak.highlight',
  link: 'textCommands.speak.link',
};

/** A color as words: a pen's name, or the value as written. */
function colorName(color: string): string {
  return (PEN_COLORS as readonly string[]).includes(color) ? t(`commands.colors.${color}` as MessageKey) : color;
}

/** The style a paragraph shows: a heading level, or its named style. */
function styleName(state: EditorState): string | null {
  const block = state.selection.$from.parent;
  if (block.type.name === 'heading') return t(`editor.commands.heading${block.attrs.level as 1}` as MessageKey);
  return typeof block.attrs.style === 'string' ? block.attrs.style : null;
}

/** The formatting at the caret, in words, in the order a person reads a toolbar. */
export function describeFormat(state: EditorState): string {
  const marks = marksAt(state);
  const attrs = (name: string) => marks.find((mark) => mark.type.name === name)?.attrs;
  const parts: string[] = [];
  const font = attrs('font')?.font;
  if (typeof font === 'string') parts.push(font);
  const size = attrs('textSize')?.size;
  if (typeof size === 'string') parts.push(t('textCommands.speak.points', { points: String(pointsOf(size) ?? size) }));
  const weight = attrs('weight')?.weight;
  if (typeof weight === 'string') parts.push(t(`textCommands.weights.w${weight}` as MessageKey));
  for (const mark of marks) {
    const name = mark.type.name;
    if (PLAIN[name]) parts.push(t(PLAIN[name]));
    else if (name === 'underline') parts.push(t('textCommands.speak.underline'));
    else if (name === 'strike') {
      parts.push(t(mark.attrs.line === 'double' ? 'textCommands.speak.doubleStrike' : 'textCommands.speak.strike'));
    } else if (name === 'caps') {
      parts.push(t(mark.attrs.caps === 'all' ? 'textCommands.speak.allCaps' : 'textCommands.speak.smallCaps'));
    } else if (name === 'textColor') {
      parts.push(t('textCommands.speak.color', { name: colorName(String(mark.attrs.color)) }));
    }
  }
  const style = styleName(state);
  if (style) parts.push(style);
  const align = paraAt(state).align;
  if (align && align !== 'start') parts.push(t(`textCommands.aligns.${align}`));
  return parts.length > 0 ? parts.join(', ') : t('textCommands.speak.plain');
}

/** Announces the formatting at the caret through the editor's host. Returns the words. */
export function speakFormat(editor: Editor): string {
  const words = describeFormat(editor.state);
  hostOf(editor)?.announce(words);
  return words;
}
