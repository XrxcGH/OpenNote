// Every Phase 4 command's keys in one table (ARCHITECTURE.md section 22.2; PLAN.md section 3.10, owned by WP0), so
// the conflict test covers the whole phase from day one. Each package registers its commands with
// registerPageCommand, which takes the keys, scope, and refinement from here. Chords are in Phase 2's canonical
// form: a chord that needs Shift to type its character is stored by that character (Ctrl+Shift+] is Ctrl+}).
import { defineCommand } from '../../commands/registry';
import type { Chord, CommandDef, CommandId, KeyScope } from '../../commands/types';
import { commands } from '../../registries';

export interface KeySpec {
  /** The default set. */
  keys: readonly string[];
  /** The OneNote set; absent means the same as `keys`. */
  oneNoteKeys?: readonly string[];
  scope: KeyScope;
  refines?: CommandId;
  allowInTextInput?: boolean;
  allowRepeat?: boolean;
}

const editor = (keys: readonly string[] = [], oneNoteKeys?: readonly string[], refines?: CommandId): KeySpec => ({
  keys,
  ...(oneNoteKeys ? { oneNoteKeys } : {}),
  scope: 'editor',
  ...(refines ? { refines } : {}),
  allowInTextInput: true,
});
const scoped = (scope: KeyScope, keys: readonly string[] = [], extra: Partial<KeySpec> = {}): KeySpec => ({
  keys,
  scope,
  ...extra,
});
const none = editor();

const headings = Object.fromEntries(
  [1, 2, 3, 4, 5, 6].map((level) => [`block.heading${level}`, editor([`Ctrl+Alt+${level}`])]),
) as Record<`block.heading${1 | 2 | 3 | 4 | 5 | 6}`, KeySpec>;
const showLevels = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => [`outline.showLevel${level}`, editor([`Alt+Shift+${level}`])]),
) as Record<`outline.showLevel${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`, KeySpec>;
const moves = { allowInTextInput: true, allowRepeat: true };

export const PAGE_KEYS = {
  // WP4: formatting, blocks, outline, typing helpers.
  'format.bold': editor(['Ctrl+B']),
  'format.italic': editor(['Ctrl+I']),
  'format.underline': editor(['Ctrl+U']),
  'format.strike': editor(['Ctrl+Shift+S'], ['Ctrl+-'], 'view.zoomOut'),
  'format.highlight': editor(['Ctrl+Shift+H'], ['Ctrl+Alt+H']),
  'format.code': editor(['Ctrl+E'], []),
  'format.subscript': editor([], ['Ctrl+='], 'view.zoomIn'),
  'format.superscript': editor([], ['Ctrl++']),
  'format.larger': editor(['Ctrl+>']),
  'format.smaller': editor(['Ctrl+<']),
  'format.textColor': none,
  'format.textSize': none,
  'format.clear': editor(['Ctrl+\\']),
  'format.clearAll': editor([], ['Ctrl+Shift+N']),
  'format.link': editor(['Ctrl+K'], undefined, 'app.palette'),
  'block.normal': editor(['Ctrl+Shift+N'], []),
  ...headings,
  'block.bulletList': editor(['Ctrl+Shift+8'], ['Ctrl+.']),
  'block.orderedList': editor(['Ctrl+Shift+7'], ['Ctrl+/'], 'app.shortcuts'),
  'block.checklist': editor(['Ctrl+Shift+9'], []),
  'block.todoCycle': none,
  'block.toggleCheck': editor(['Ctrl+Enter']),
  'block.quote': editor(['Ctrl+Shift+B']),
  'block.codeBlock': none,
  'block.callout': none,
  'block.divider': none,
  'block.turnInto': none,
  'outline.moveUp': scoped('editor', ['Alt+Shift+Up'], moves),
  'outline.moveDown': scoped('editor', ['Alt+Shift+Down'], moves),
  'outline.promote': scoped('editor', ['Alt+Shift+Left'], moves),
  'outline.demote': scoped('editor', ['Alt+Shift+Right'], moves),
  ...showLevels,
  'outline.showAll': editor(['Alt+Shift+0']),
  'outline.fold': editor(['Alt+_']),
  'outline.unfold': editor(['Alt++']),
  'insert.date': editor(['Alt+Shift+D']),
  'insert.time': editor(['Alt+Shift+T']),
  'insert.dateTime': editor(['Alt+Shift+F']),
  'text.setColor': scoped('pageObject'),
  // WP3: the page, zoom, and objects.
  'page.zoomIn': scoped('page', ['Ctrl+Alt+='], { allowInTextInput: true }),
  'page.zoomOut': scoped('page', ['Ctrl+Alt+-'], { allowInTextInput: true }),
  'page.zoom100': scoped('page', ['Ctrl+Alt+0'], { allowInTextInput: true }),
  'page.zoomFitWidth': scoped('page'),
  'page.newTextBox': scoped('page'),
  'page.layout': scoped('page'),
  'page.readingOrderPane': scoped('page'),
  'page.readingView': scoped('page'),
  'object.bringToFront': scoped('pageObject', ['Ctrl+}']),
  'object.sendToBack': scoped('pageObject', ['Ctrl+{']),
  'object.bringForward': scoped('pageObject', ['Ctrl+]']),
  'object.sendBackward': scoped('pageObject', ['Ctrl+[']),
  'object.edit': scoped('pageObject', ['F2']),
  'object.delete': scoped('pageObject', ['Delete']),
  'object.lock': scoped('pageObject'),
  'object.lockPosition': scoped('pageObject'),
  'object.unlock': scoped('pageObject'),
  'object.float': scoped('pageObject'),
  'object.putInFlow': scoped('pageObject'),
  'object.sizeAndPosition': scoped('pageObject'),
  // WP2: page undo and redo, more specific than the tree's.
  'page.undo': scoped('page', ['Ctrl+Z'], { refines: 'edit.undo', allowInTextInput: true, allowRepeat: true }),
  'page.redo': scoped('page', ['Ctrl+Y', 'Ctrl+Shift+Z'], {
    refines: 'edit.redo',
    allowInTextInput: true,
    allowRepeat: true,
  }),
  // WP5: images and copying.
  'insert.image': none,
  'object.crop': scoped('pageObject'),
  'object.altText': scoped('pageObject'),
  'edit.copyAsMarkdown': scoped('page', [], { allowInTextInput: true }),
  // WP6: tables and code.
  'insert.table': none,
  'table.rowAbove': scoped('editor.table', [], { allowInTextInput: true }),
  'table.rowBelow': scoped('editor.table', ['Ctrl+Enter'], { refines: 'block.toggleCheck', allowInTextInput: true }),
  'table.columnLeft': { keys: [], oneNoteKeys: ['Ctrl+Alt+E'], scope: 'editor.table', allowInTextInput: true },
  'table.columnRight': { keys: [], oneNoteKeys: ['Ctrl+Alt+R'], scope: 'editor.table', allowInTextInput: true },
  'table.deleteRow': scoped('editor.table', [], { allowInTextInput: true }),
  'table.deleteColumn': scoped('editor.table', [], { allowInTextInput: true }),
  'table.deleteTable': scoped('editor.table', [], { allowInTextInput: true }),
  'table.headerRow': scoped('editor.table', [], { allowInTextInput: true }),
  'table.moveRowUp': scoped('editor.table', [], { allowInTextInput: true }),
  'table.moveRowDown': scoped('editor.table', [], { allowInTextInput: true }),
  'table.columnWidth': scoped('editor.table', [], { allowInTextInput: true }),
  'table.select': scoped('editor.table', [], { allowInTextInput: true }),
  'code.setLanguage': scoped('editor.code', [], { allowInTextInput: true }),
  'code.exit': scoped('editor.code', ['Ctrl+Enter'], { refines: 'block.toggleCheck', allowInTextInput: true }),
  // WP7: spelling, read aloud, and history.
  'spelling.next': editor(['F7']),
  'spelling.previous': editor(['Shift+F7']),
  'readAloud.toggle': scoped('page', ['Ctrl+Shift+U'], { allowInTextInput: true }),
  'readAloud.nextParagraph': scoped('page', ['Ctrl+Alt+.'], { allowInTextInput: true }),
  'readAloud.previousParagraph': scoped('page', ['Ctrl+Alt+,'], { allowInTextInput: true }),
  'readAloud.stop': scoped('page', [], { allowInTextInput: true }),
  'history.open': scoped('page'),
  'history.compareWith': scoped('page'),
  'history.nextChange': scoped('page', ['F8'], { allowInTextInput: true }),
  'history.previousChange': scoped('page', ['Shift+F8'], { allowInTextInput: true }),
  'history.nameVersion': scoped('page'),
  'history.deleteHistory': scoped('page'),
} as const satisfies Record<string, KeySpec>;

export type PageCommandId = keyof typeof PAGE_KEYS;

type Chords = readonly Chord[];

/** The command definition with its keys from PAGE_KEYS, without registering it. */
export function pageCommandDef<Args = void>(
  def: Omit<CommandDef<Args>, 'keys' | 'scope'> & { id: PageCommandId },
): CommandDef<Args> {
  const spec: KeySpec = PAGE_KEYS[def.id];
  return defineCommand<Args>({
    ...def,
    keys: spec.keys as Chords,
    ...(spec.oneNoteKeys ? { presetKeys: { onenote: spec.oneNoteKeys as Chords } } : {}),
    scope: spec.scope,
    ...(spec.refines ? { refines: spec.refines } : {}),
    ...(spec.allowInTextInput ? { allowInTextInput: true } : {}),
    ...(spec.allowRepeat ? { allowRepeat: true } : {}),
  });
}

/** Registers a Phase 4 command with its keys from PAGE_KEYS. Returns the function that removes it. */
export function registerPageCommand<Args = void>(
  def: Omit<CommandDef<Args>, 'keys' | 'scope'> & { id: PageCommandId },
): () => void {
  return commands.register(pageCommandDef(def));
}
