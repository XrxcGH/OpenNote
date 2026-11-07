// The keys of the text formatting commands, one table part spread into PAGE_KEYS (features/page/keys.ts).
// Owner: text:shortcuts (B10). text:scaffold wrote it empty, so lanes never edit keys.ts for these commands.
// Add entries as literal KeySpecs, for example `'format.fontFamily': { keys: ['Ctrl+Shift+F'], scope: 'editor' }`.
import type { KeySpec } from '../keys';

export const TEXT_KEYS = {
  // text:page-layout: Word's keys for breaks. Ctrl+Enter still checks a task item first (the command is off there),
  // and the OneNote set keeps Ctrl+Enter for Check or uncheck.
  'insert.pageBreak': {
    keys: ['Ctrl+Enter'],
    oneNoteKeys: [],
    scope: 'editor',
    refines: 'block.toggleCheck',
    allowInTextInput: true,
  },
  'insert.columnBreak': { keys: ['Ctrl+Shift+Enter'], oneNoteKeys: [], scope: 'editor', allowInTextInput: true },
  'layout.headerFooter': { keys: [], scope: 'editor', allowInTextInput: true },
  'layout.lineNumbers': { keys: [], scope: 'editor', allowInTextInput: true },
  'layout.verticalText': { keys: [], scope: 'editor', allowInTextInput: true },
  'layout.columns1': { keys: [], scope: 'editor', allowInTextInput: true },
  'layout.columns2': { keys: [], scope: 'editor', allowInTextInput: true },
  'layout.columns3': { keys: [], scope: 'editor', allowInTextInput: true },
  'layout.columns4': { keys: [], scope: 'editor', allowInTextInput: true },
} as const satisfies Record<string, KeySpec>;
