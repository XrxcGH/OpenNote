// The keys of the text formatting commands, one table part spread into PAGE_KEYS (features/page/keys.ts).
// Owner: text:shortcuts (B10). text:scaffold wrote it empty, so lanes never edit keys.ts for these commands.
// Add entries as literal KeySpecs, for example `'format.fontFamily': { keys: ['Ctrl+Shift+F'], scope: 'editor' }`.
import type { KeySpec } from '../keys';

export const TEXT_KEYS = {
  // text:page-layout: Word's keys for breaks, on the default set only (the OneNote set is unchanged). Ctrl+Enter
  // refines Check or uncheck: it is a page break only where the command is on (text.layout, a paginated page, not in
  // a task item), and Check or uncheck keeps the chord everywhere else.
  'insert.pageBreak': {
    keys: ['Ctrl+Enter'],
    oneNoteKeys: [],
    refines: 'block.toggleCheck',
    scope: 'editor',
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
