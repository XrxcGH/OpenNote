// @vitest-environment jsdom
// The code editor's keymap (DESIGN 5.3). Known answers: VS Code's documented default keybindings for Windows name
// the command each chord runs. The code editor runs the matching command with every app feature registered. So a
// chord the app uses elsewhere (F8, Ctrl+D, Ctrl+/, Ctrl+H, Ctrl+G) goes to the code editor while it has focus.
// The completion keys follow the owner decision instead: Tab indents (tab.test.ts) and Ctrl+Tab accepts.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../../../features';

// The palette loads on the first Ctrl press; a load that outlives the test file fails the teardown.
vi.mock('../../palette/open', async (original) => ({ ...(await original<object>()), preloadWhenIdle: () => () => {} }));
import { commandForKey, reachesCommandsInText } from '../../../commands/dispatcher';
import { commandsForChord, defaultConflicts } from '../../../commands/keymap';
import { chord, defineCommand } from '../../../commands/registry';
import { F10_STEPS_OVER_WHILE_PAUSED, chordProblem } from '../../../commands/reserved';
import type { Chord, CommandId } from '../../../commands/types';
import { commands } from '../../../registries';
import { configureTestCommands, keyEvent, mount, unmountAll } from './testEditor';
import type { Mods } from './testEditor';

beforeAll(configureTestCommands);
afterEach(unmountAll);

/** [chord, VS Code's command for it, the code editor's command]. */
const KNOWN: readonly [string, string, CommandId][] = [
  ['Ctrl+D', 'editor.action.addSelectionToNextFindMatch', 'code.editor.addNextOccurrence'],
  ['Ctrl+/', 'editor.action.commentLine', 'code.editor.toggleLineComment'],
  ['Alt+Shift+A', 'editor.action.blockComment', 'code.editor.toggleBlockComment'],
  ['Alt+Up', 'editor.action.moveLinesUpAction', 'code.editor.moveLineUp'],
  ['Alt+Down', 'editor.action.moveLinesDownAction', 'code.editor.moveLineDown'],
  ['Alt+Shift+Up', 'editor.action.copyLinesUpAction', 'code.editor.copyLineUp'],
  ['Alt+Shift+Down', 'editor.action.copyLinesDownAction', 'code.editor.copyLineDown'],
  ['Ctrl+Shift+K', 'editor.action.deleteLines', 'code.editor.deleteLine'],
  ['Ctrl+Alt+Up', 'editor.action.insertCursorAbove', 'code.editor.cursorAbove'],
  ['Ctrl+Alt+Down', 'editor.action.insertCursorBelow', 'code.editor.cursorBelow'],
  ['Ctrl+F', 'actions.find', 'code.editor.find'],
  ['Ctrl+H', 'editor.action.startFindReplaceAction', 'code.editor.replace'],
  ['Ctrl+G', 'workbench.action.gotoLine', 'code.editor.goToLine'],
  ['Alt+Shift+Right', 'editor.action.smartSelect.expand', 'code.editor.expandSelection'],
  ['Alt+Shift+Left', 'editor.action.smartSelect.shrink', 'code.editor.shrinkSelection'],
  ['Alt+Z', 'editor.action.toggleWordWrap', 'code.editor.wordWrap'],
  ['Ctrl+=', 'workbench.action.zoomIn', 'code.editor.zoomIn'],
  ['Ctrl+-', 'workbench.action.zoomOut', 'code.editor.zoomOut'],
  ['Ctrl+Space', 'editor.action.triggerSuggest', 'code.completion.list'],
  ['Alt+\\', 'editor.action.inlineSuggest.trigger', 'code.completion.request'],
  ['Ctrl+Right', 'editor.action.inlineSuggest.acceptNextWord', 'code.completion.acceptWord'],
  ['Alt+]', 'editor.action.inlineSuggest.showNext', 'code.completion.next'],
  ['Alt+[', 'editor.action.inlineSuggest.showPrevious', 'code.completion.previous'],
  ['F8', 'editor.action.marker.nextInFiles', 'code.problem.next'],
  ['Shift+F8', 'editor.action.marker.prevInFiles', 'code.problem.previous'],
  ['Ctrl+M', 'editor.action.toggleTabFocusMode', 'code.editor.tabMovesFocus'],
];

const KEY_NAMES: Readonly<Record<string, string>> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

function eventFor(text: string): KeyboardEvent {
  const parts = text.split('+');
  const name = parts.pop() ?? '';
  const mods: Mods = { ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt'), shift: parts.includes('Shift') };
  const key = KEY_NAMES[name] ?? (name.length === 1 ? name.toLowerCase() : name);
  return keyEvent(key, mods);
}

describe('the DESIGN 5.3 keys', () => {
  it.each(KNOWN)('%s runs the command VS Code documents as %s', async (text, _vscode, id) => {
    expect(commandsForChord(chord(text)).some((def) => def.id === id && def.scope === 'codeEditor')).toBe(true);
    if (!reachesCommandsInText(chord(text))) return;
    const editor = await mount({ language: 'python', text: 'a\nb', caret: 0 });
    // A ghost text makes the suggestion keys available, as they are only while one shows.
    editor.showGhost([{ from: 0, text: 'x', origin: 'pattern', confidence: 1 }]);
    const event = eventFor(text);
    const press = Object.assign(
      { key: event.key, code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey },
      {
        metaKey: false,
        isComposing: false,
        repeat: false,
        getModifierState: () => false,
        target: editor.view.contentDOM,
      },
    );
    expect(commandForKey(press)?.id).toBe(id);
  });
});

describe('Ctrl+Tab and the conflict checker', () => {
  it('binds code.completion.accept to Ctrl+Tab, refining Next tab, with no default conflicts', () => {
    const accept = commands.get('code.completion.accept');
    expect(accept?.keys).toEqual(['Ctrl+Tab']);
    expect(accept?.refines).toBe('tabs.next');
    expect(defaultConflicts('default')).toEqual([]);
    expect(defaultConflicts('onenote')).toEqual([]);
  });

  it('reports a conflict once the refinement is gone', () => {
    const accept = commands.get('code.completion.accept');
    if (!accept) throw new Error('code.completion.accept is not registered');
    const stop = commands.register(
      defineCommand({ ...accept, id: 'test.code.acceptWithoutRefines' as CommandId, refines: undefined }),
    );
    try {
      expect(defaultConflicts('default')).toContain('Ctrl+Tab: tabs.next and test.code.acceptWithoutRefines');
    } finally {
      stop();
    }
  });
});

describe('F10 (owner decision D7)', () => {
  it('is unbound in the code editor, and allowed only while paused in the debugger', () => {
    expect(F10_STEPS_OVER_WHILE_PAUSED).toBe(true);
    expect(commandsForChord('F10' as Chord).filter((def) => def.scope === 'codeEditor')).toEqual([]);
    expect(chordProblem('F10' as Chord)).toBe('windows');
    expect(chordProblem('F10' as Chord, 'codeEditor')).toBe('windows');
    expect(chordProblem('F10' as Chord, 'codeDebug')).toBeNull();
    // With the flag off, F10 stays reserved even while paused.
    expect(chordProblem('F10' as Chord, 'codeDebug', false)).toBe('windows');
  });
});

afterAll(unmountAll);
