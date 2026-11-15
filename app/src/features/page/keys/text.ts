// The keys of the text formatting commands, one table part spread into PAGE_KEYS (features/page/keys.ts).
// Owner: text:shortcuts (B10). ADR 0085: the default set follows Word for Windows, the Docs set follows Google Docs,
// and the OneNote set keeps OneNote's meanings. Chords are in Phase 2's canonical form (Ctrl+Shift+> is Ctrl+>).
// A key lists the default set first, then Docs, then OneNote. A set that leaves a key out writes an empty list, so
// it never inherits a chord that means something else there. The Ctrl+Enter page break, the style box, and the
// format painter's paste key are explained in the ADR.
import type { CommandId } from '../../../commands/types';
import type { KeySpec } from '../keys';

/** A text command's chords: the default set (Word), the Docs set, and the OneNote set (the default's when omitted). */
const text = (
  keys: readonly string[],
  docsKeys: readonly string[],
  oneNoteKeys?: readonly string[],
  refines?: CommandId,
): KeySpec => ({
  keys,
  ...(refines ? { refines } : {}),
  docsKeys,
  ...(oneNoteKeys ? { oneNoteKeys } : {}),
  scope: 'editor',
  allowInTextInput: true,
});

export const TEXT_KEYS = {
  // Character formatting.
  'format.allCaps': text(['Ctrl+Shift+A'], []),
  'format.smallCaps': text(['Ctrl+Shift+K'], []),
  'format.cycleCase': text(['Shift+F3'], []),
  'format.clearCharacter': text(['Ctrl+Space'], []),
  'format.fontSizeUp': text(['Ctrl+]'], []),
  'format.fontSizeDown': text(['Ctrl+['], []),
  'format.copyFormat': text(['Ctrl+Shift+C'], ['Ctrl+Alt+C']),
  // Ctrl+Shift+V stays "paste as plain text" (a fixed key), so pasting a format takes Ctrl+Alt+Shift+V in every set.
  'format.pasteFormat': text(['Ctrl+Alt+Shift+V'], ['Ctrl+Alt+Shift+V']),
  'format.repeat': text(['F4'], []),
  'format.applyStyle': text(['Ctrl+Shift+S'], [], []),
  // The Format pane: Ctrl+D opens it on Text (Word's Font dialog). Docs has no such key.
  'format.fontDialog': text(['Ctrl+D'], []),
  // Paragraph formatting.
  'para.alignStart': text(['Ctrl+L'], ['Ctrl+Shift+L']),
  'para.alignCenter': text(['Ctrl+E'], ['Ctrl+Shift+E'], []),
  'para.alignEnd': text(['Ctrl+R'], ['Ctrl+Shift+R']),
  'para.justify': text(['Ctrl+J'], ['Ctrl+Shift+J'], []),
  'para.distribute': text(['Ctrl+Shift+J'], [], []),
  // Ctrl+1 to Ctrl+9 are the OneNote set's line tags, so line spacing has no key there.
  'para.lineSingle': text(['Ctrl+1'], [], []),
  'para.lineDouble': text(['Ctrl+2'], [], []),
  'para.line15': text(['Ctrl+5'], [], []),
  // Ctrl+0 (Word's 12 pt before) stays the interface text size reset, and Ctrl+Shift+T stays Reopen closed tab.
  'para.spaceBefore': text([], []),
  'para.indent': text(['Ctrl+M'], ['Ctrl+]'], []),
  'para.outdent': text(['Ctrl+Shift+M'], ['Ctrl+['], []),
  'para.hanging': text(['Ctrl+T'], [], [], 'notes.newSection'),
  'para.removeHanging': text([], []),
  'para.reset': text(['Ctrl+Q'], [], []),
  // Ctrl+Enter breaks the page where it applies and otherwise toggles a task's check (block.toggleCheck refines it).
  'insert.pageBreak': {
    keys: ['Ctrl+Enter'],
    docsKeys: ['Ctrl+Enter'],
    oneNoteKeys: [],
    scope: 'page',
    allowInTextInput: true,
  },
  // text:page-layout: Word's and Docs' key for a column break. The layout commands have no chord.
  'insert.columnBreak': text(['Ctrl+Shift+Enter'], ['Ctrl+Shift+Enter'], []),
  'insert.pageBreakMenu': text([], [], []),
  'layout.headerFooter': text([], []),
  'layout.lineNumbers': text([], []),
  'layout.verticalText': text([], []),
  'layout.columns1': text([], []),
  'layout.columns2': text([], []),
  'layout.columns3': text([], []),
  'layout.columns4': text([], []),
} as const satisfies Record<string, KeySpec>;
