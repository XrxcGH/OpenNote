// The code editor's commands in the registry (DESIGN 5.3 and 5.3.1). They load at start-up, so the shortcut list
// and the conflict checker know them, and import nothing from CodeMirror: each runs an action on the focused editor
// through views.ts. Every one lives in the codeEditor scope, so it wins over page, editor, and app commands while a
// code editor has focus. Owner: code:L01.
//
// A chord the app uses elsewhere refines that command, so the conflict checker knows the code editor wins there.
// Ctrl+Tab: code.completion.accept refines tabs.next. With a suggestion showing it accepts; with none it asks for
// one; with suggestions Off and nothing showing it is disabled, so the key goes on to the next page tab.
// Ctrl+Space, Ctrl+Shift+K, and Ctrl+M refine clear formatting, small caps, and indent the same way.

import { chord, defineCommand } from '../../../commands/registry';
import type { CommandDef, CommandId } from '../../../commands/types';
import { commands } from '../../../registries';
import { getSettings } from '../../../state/settings';
import { announce } from '../../../ui/announce';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { focusedCodeEditor, getTabMovesFocus, setTabMovesFocus, textFocusedCodeEditor } from './views';
import type { CodeEditorHandle, EditorAction } from './views';

interface Row {
  id: CommandId;
  action: EditorAction;
  title: MessageKey;
  keys?: readonly string[];
  refines?: CommandId;
  /** Runs only while this is true for the focused editor. */
  enabled?: (editor: CodeEditorHandle) => boolean;
  /** Changes the text, so a read-only editor turns it off. */
  edits?: boolean;
  /** Also runs while focus is in the editor's search panel or go-to-line field, not only in its text. */
  panel?: boolean;
}

const suggestionsOn = () => getSettings().code.suggestions !== 'off';

/** The table of DESIGN 5.3: command, action, default chords. Tab, Shift+Tab, Escape, and Enter are fixed keys. */
export const CODE_EDITOR_ROWS: readonly Row[] = [
  {
    id: 'code.completion.accept',
    action: 'completion.accept',
    title: 'codeStudio.editor.commands.accept',
    keys: ['Ctrl+Tab'],
    refines: 'tabs.next',
    edits: true,
    enabled: (editor) => editor.suggestionShowing() || suggestionsOn(),
  },
  {
    id: 'code.completion.request',
    action: 'completion.request',
    title: 'codeStudio.editor.commands.request',
    keys: ['Alt+\\'],
    edits: true,
  },
  {
    id: 'code.completion.list',
    action: 'completion.list',
    title: 'codeStudio.editor.commands.list',
    keys: ['Ctrl+Space'],
    refines: 'format.clearCharacter',
    edits: true,
  },
  {
    id: 'code.completion.acceptWord',
    action: 'completion.acceptWord',
    title: 'codeStudio.editor.commands.acceptWord',
    keys: ['Ctrl+Right'],
    edits: true,
    enabled: (editor) => editor.hasGhost(),
  },
  {
    id: 'code.completion.acceptLine',
    action: 'completion.acceptLine',
    title: 'codeStudio.editor.commands.acceptLine',
    edits: true,
    enabled: (editor) => editor.hasGhost(),
  },
  {
    id: 'code.completion.dismiss',
    action: 'completion.dismiss',
    title: 'codeStudio.editor.commands.dismiss',
    enabled: (editor) => editor.suggestionShowing(),
  },
  {
    id: 'code.completion.next',
    action: 'completion.next',
    title: 'codeStudio.editor.commands.next',
    keys: ['Alt+]'],
    enabled: (editor) => editor.hasGhost(),
  },
  {
    id: 'code.completion.previous',
    action: 'completion.previous',
    title: 'codeStudio.editor.commands.previous',
    keys: ['Alt+['],
    enabled: (editor) => editor.hasGhost(),
  },
  {
    id: 'code.editor.addNextOccurrence',
    action: 'addNextOccurrence',
    title: 'codeStudio.editor.commands.addNextOccurrence',
    keys: ['Ctrl+D'],
  },
  {
    id: 'code.editor.toggleLineComment',
    action: 'toggleLineComment',
    title: 'codeStudio.editor.commands.toggleLineComment',
    keys: ['Ctrl+/'],
    refines: 'block.orderedList',
    edits: true,
  },
  {
    id: 'code.editor.toggleBlockComment',
    action: 'toggleBlockComment',
    title: 'codeStudio.editor.commands.toggleBlockComment',
    keys: ['Alt+Shift+A'],
    refines: 'audio.record',
    edits: true,
  },
  {
    id: 'code.editor.moveLineUp',
    action: 'moveLineUp',
    title: 'codeStudio.editor.commands.moveLineUp',
    keys: ['Alt+Up'],
    edits: true,
  },
  {
    id: 'code.editor.moveLineDown',
    action: 'moveLineDown',
    title: 'codeStudio.editor.commands.moveLineDown',
    keys: ['Alt+Down'],
    edits: true,
  },
  {
    id: 'code.editor.copyLineUp',
    action: 'copyLineUp',
    title: 'codeStudio.editor.commands.copyLineUp',
    keys: ['Alt+Shift+Up'],
    refines: 'outline.moveUp',
    edits: true,
  },
  {
    id: 'code.editor.copyLineDown',
    action: 'copyLineDown',
    title: 'codeStudio.editor.commands.copyLineDown',
    keys: ['Alt+Shift+Down'],
    refines: 'outline.moveDown',
    edits: true,
  },
  {
    id: 'code.editor.deleteLine',
    action: 'deleteLine',
    title: 'codeStudio.editor.commands.deleteLine',
    keys: ['Ctrl+Shift+K'],
    refines: 'format.smallCaps',
    edits: true,
  },
  {
    id: 'code.editor.cursorAbove',
    action: 'cursorAbove',
    title: 'codeStudio.editor.commands.cursorAbove',
    keys: ['Ctrl+Alt+Up'],
  },
  {
    id: 'code.editor.cursorBelow',
    action: 'cursorBelow',
    title: 'codeStudio.editor.commands.cursorBelow',
    keys: ['Ctrl+Alt+Down'],
  },
  {
    id: 'code.editor.find',
    action: 'find',
    panel: true,
    title: 'codeStudio.editor.commands.find',
    keys: ['Ctrl+F'],
    refines: 'page.find',
  },
  {
    id: 'code.editor.replace',
    action: 'replace',
    panel: true,
    title: 'codeStudio.editor.commands.replace',
    keys: ['Ctrl+H'],
    refines: 'page.replace',
    edits: true,
  },
  {
    id: 'code.editor.goToLine',
    action: 'goToLine',
    panel: true,
    title: 'codeStudio.editor.commands.goToLine',
    keys: ['Ctrl+G'],
  },
  {
    id: 'code.editor.expandSelection',
    action: 'expandSelection',
    title: 'codeStudio.editor.commands.expandSelection',
    keys: ['Alt+Shift+Right'],
    refines: 'outline.demote',
  },
  {
    id: 'code.editor.shrinkSelection',
    action: 'shrinkSelection',
    title: 'codeStudio.editor.commands.shrinkSelection',
    keys: ['Alt+Shift+Left'],
    refines: 'outline.promote',
  },
  {
    id: 'code.editor.wordWrap',
    action: 'wordWrap',
    panel: true,
    title: 'codeStudio.editor.commands.wordWrap',
    keys: ['Alt+Z'],
  },
  {
    id: 'code.editor.zoomIn',
    action: 'zoomIn',
    panel: true,
    title: 'codeStudio.editor.commands.zoomIn',
    keys: ['Ctrl+='],
    refines: 'format.subscript',
  },
  {
    id: 'code.editor.zoomOut',
    action: 'zoomOut',
    panel: true,
    title: 'codeStudio.editor.commands.zoomOut',
    keys: ['Ctrl+-'],
    refines: 'format.strike',
  },
  {
    id: 'code.problem.next',
    action: 'problemNext',
    panel: true,
    title: 'codeStudio.editor.commands.problemNext',
    keys: ['F8'],
    refines: 'history.nextChange',
  },
  {
    id: 'code.problem.previous',
    action: 'problemPrevious',
    panel: true,
    title: 'codeStudio.editor.commands.problemPrevious',
    keys: ['Shift+F8'],
    refines: 'history.previousChange',
  },
];

function rowCommand(row: Row): CommandDef {
  const target = () => (row.panel ? focusedCodeEditor() : textFocusedCodeEditor());
  return defineCommand({
    id: row.id,
    title: row.title,
    category: 'code',
    scope: 'codeEditor',
    keys: row.keys?.map(chord),
    refines: row.refines,
    allowInTextInput: true,
    allowRepeat: row.action.startsWith('move') || row.action.startsWith('copy') || row.action.startsWith('cursor'),
    palette: false,
    flag: 'code.studio',
    when: () => target() !== null,
    enabled: () => {
      const editor = target();
      if (!editor || (row.edits && editor.readOnly)) return false;
      return !row.enabled || row.enabled(editor);
    },
    run: () => {
      target()?.run(row.action);
    },
  });
}

/** Ctrl+M (Shift+Alt+M on macOS, checked with the macOS port): Tab moves focus instead of indenting. */
export const tabMovesFocusCommand = defineCommand({
  id: 'code.editor.tabMovesFocus',
  title: 'codeStudio.editor.commands.tabMovesFocus',
  category: 'code',
  scope: 'codeEditor',
  keys: [chord('Ctrl+M')],
  refines: 'para.indent',
  allowInTextInput: true,
  palette: false,
  flag: 'code.studio',
  when: () => focusedCodeEditor() !== null,
  checked: () => getTabMovesFocus(),
  run: () => {
    setTabMovesFocus(!getTabMovesFocus());
    announce(
      t(getTabMovesFocus() ? 'codeStudio.editor.say.tabMovesFocusOn' : 'codeStudio.editor.say.tabMovesFocusOff'),
    );
  },
});

export const CODE_EDITOR_COMMANDS: readonly CommandDef[] = [...CODE_EDITOR_ROWS.map(rowCommand), tabMovesFocusCommand];

/** Registers the commands once. Returns a function that removes the ones it added. */
export function registerCodeEditorCommands(): () => void {
  const stops = CODE_EDITOR_COMMANDS.filter((def) => !commands.get(def.id)).map((def) => commands.register(def));
  return () => stops.forEach((stop) => stop());
}
