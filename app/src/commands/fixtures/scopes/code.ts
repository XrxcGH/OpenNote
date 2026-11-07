// The keys of a focused code editor, and of one paused in the debugger. Owner: code:L01. shared:x-shared wrote the
// first cases from the plan's key table; code:L01 gave the editor's commands their real IDs
// (features/codestudio/editor/commands.ts). code.run, code.breakpoint.toggle, code.debug.*, and code.editor.keepKey
// stay stand-ins until their lanes (code:L03, code:L14b, code:L19) register them.
//
// `code.editor.keepKey` stands for the chords that the code editor keeps from the text program. The code editor
// sits inside the page editor's scope, so without it Ctrl+` would make inline code. F10 steps over only while a
// debug session is paused (owner decision D7): the narrow exception in commands/reserved.ts.
import type { ScopeFixture } from './types';

export const codeScopes: ScopeFixture = {
  program: 'code',
  owner: 'code:L01',
  commands: [
    { id: 'code.editor.addNextOccurrence', scope: 'codeEditor', keys: ['Ctrl+D'] },
    { id: 'code.run', scope: 'codeEditor', keys: ['Ctrl+Enter'] },
    { id: 'code.completion.list', scope: 'codeEditor', keys: ['Ctrl+Space'] },
    { id: 'code.completion.request', scope: 'codeEditor', keys: ['Alt+\\'] },
    { id: 'code.editor.tabMovesFocus', scope: 'codeEditor', keys: ['Ctrl+M'] },
    { id: 'code.problem.next', scope: 'codeEditor', keys: ['F8'] },
    { id: 'code.breakpoint.toggle', scope: 'codeEditor', keys: ['F9'] },
    { id: 'code.completion.accept', scope: 'codeEditor', keys: ['Ctrl+Tab'], refines: 'tabs.next' },
    { id: 'code.editor.keepKey', scope: 'codeEditor', keys: ['Ctrl+R', 'Ctrl+5', 'Shift+F3', 'Ctrl+`'] },
    { id: 'code.debug.continue', scope: 'codeDebug', keys: ['F5'] },
    { id: 'code.debug.stepOver', scope: 'codeDebug', keys: ['F10'] },
  ],
  cases: [
    { chord: 'Ctrl+D', at: 'codeEditor', expect: 'code.editor.addNextOccurrence', why: 'add the next occurrence' },
    { chord: 'Ctrl+R', at: 'codeEditor', expect: 'code.editor.keepKey', why: 'the editor keeps Ctrl+R' },
    { chord: 'Ctrl+Enter', at: 'codeEditor', expect: 'code.run', why: 'Ctrl+Enter runs the code' },
    { chord: 'Ctrl+5', at: 'codeEditor', expect: 'code.editor.keepKey', why: 'no text meaning for Ctrl+5' },
    { chord: 'Shift+F3', at: 'codeEditor', expect: 'code.editor.keepKey', why: 'no text meaning for Shift+F3' },
    { chord: 'Ctrl+Space', at: 'codeEditor', expect: 'code.completion.list', why: 'open the completion list' },
    { chord: 'Alt+\\', at: 'codeEditor', expect: 'code.completion.request', why: 'show a suggestion' },
    { chord: 'Ctrl+M', at: 'codeEditor', expect: 'code.editor.tabMovesFocus', why: 'Tab moves focus' },
    { chord: 'F8', at: 'codeEditor', expect: 'code.problem.next', why: 'F8 is the next problem in code' },
    { chord: 'F9', at: 'codeEditor', expect: 'code.breakpoint.toggle', why: 'toggle a breakpoint' },
    { chord: 'Ctrl+`', at: 'codeEditor', expect: 'code.editor.keepKey', why: 'no inline code in code' },
    { chord: 'Ctrl+Tab', at: 'codeEditor', expect: 'code.completion.accept', why: 'Ctrl+Tab accepts the suggestion' },
    {
      chord: 'Ctrl+Tab',
      at: 'codeEditor',
      disabled: ['code.completion.accept'],
      expect: 'tabs.next',
      why: 'with suggestions off, Ctrl+Tab is the next page tab',
    },
    { chord: 'Ctrl+Shift+Tab', at: 'codeEditor', expect: 'tabs.previous', why: 'Ctrl+Shift+Tab is never taken' },
    {
      chord: 'Ctrl+K',
      at: 'codeEditor',
      disabled: ['format.link'],
      expect: 'app.palette',
      why: 'Ctrl+K opens the palette in code',
    },
    { chord: 'F9', at: 'codeDebug', expect: 'code.breakpoint.toggle', why: 'paused: F9 still toggles a breakpoint' },
    { chord: 'F5', at: 'codeDebug', expect: 'code.debug.continue', why: 'paused: F5 continues' },
    { chord: 'F5', at: 'codeEditor', expect: null, why: 'not paused: F5 does nothing' },
    { chord: 'F10', at: 'codeDebug', expect: 'code.debug.stepOver', why: 'paused: F10 steps over (D7)' },
    { chord: 'F10', at: 'codeEditor', expect: null, why: 'not paused: F10 stays with Windows' },
  ],
};
