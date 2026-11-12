// The text program's keys in the Word default set, with the other sets where they differ. Owner: text:shortcuts.
// shared:x-shared wrote the first cases from the plan's key table. The IDs are stand-ins until the formatting
// commands exist.
import type { ScopeFixture } from './types';

export const textScopes: ScopeFixture = {
  program: 'text',
  owner: 'text:shortcuts',
  commands: [
    { id: 'format.link', scope: 'editor', keys: ['Ctrl+K'], refines: 'app.palette' },
    { id: 'format.fontDialog', scope: 'editor', keys: ['Ctrl+D'] },
    { id: 'format.alignRight', scope: 'editor', keys: ['Ctrl+R'] },
    { id: 'insert.pageBreak', scope: 'page', keys: ['Ctrl+Enter'], presetKeys: { onenote: [] } },
    { id: 'block.toggleCheck', scope: 'editor', keys: ['Ctrl+Enter'], refines: 'insert.pageBreak' },
    { id: 'format.lineSpacing15', scope: 'editor', keys: ['Ctrl+5'] },
    { id: 'format.changeCase', scope: 'editor', keys: ['Shift+F3'] },
    { id: 'format.clearCharacter', scope: 'editor', keys: ['Ctrl+Space'] },
    { id: 'format.inlineCode', scope: 'editor', keys: ['Ctrl+`'] },
    {
      id: 'format.strikethrough',
      scope: 'editor',
      keys: ['Ctrl+Shift+X'],
      presetKeys: { docs: ['Alt+Shift+5'], onenote: ['Ctrl+-'] },
    },
    { id: 'format.applyStyle', scope: 'editor', keys: ['Ctrl+Shift+S'], presetKeys: { onenote: [] } },
  ],
  cases: [
    { chord: 'Ctrl+D', at: 'editor', expect: 'format.fontDialog', why: 'Ctrl+D opens Font in text' },
    { chord: 'Ctrl+R', at: 'editor', expect: 'format.alignRight', why: 'Ctrl+R aligns right in text' },
    {
      chord: 'Ctrl+Enter',
      at: 'editor',
      disabled: ['block.toggleCheck'],
      expect: 'insert.pageBreak',
      why: 'Ctrl+Enter is a page break in text outside a task item',
    },
    {
      chord: 'Ctrl+Enter',
      at: 'editor',
      expect: 'block.toggleCheck',
      why: 'Ctrl+Enter toggles the check in a task item',
    },
    {
      chord: 'Ctrl+Enter',
      at: 'editor',
      preset: 'onenote',
      expect: 'block.toggleCheck',
      why: 'the OneNote set keeps Ctrl+Enter for the check',
    },
    { chord: 'Ctrl+5', at: 'editor', expect: 'format.lineSpacing15', why: 'Ctrl+5 is 1.5 line spacing in text' },
    { chord: 'Shift+F3', at: 'editor', expect: 'format.changeCase', why: 'Shift+F3 cycles the case in text' },
    { chord: 'Ctrl+Space', at: 'editor', expect: 'format.clearCharacter', why: 'Ctrl+Space clears formatting' },
    { chord: 'F9', at: 'editor', expect: null, why: 'F9 does nothing in text' },
    { chord: 'Ctrl+`', at: 'editor', expect: 'format.inlineCode', why: 'Ctrl+` is inline code in text' },
    { chord: 'Ctrl+K', at: 'editor', expect: 'format.link', why: 'Ctrl+K adds a link with text selected' },
    {
      chord: 'Ctrl+K',
      at: 'editor',
      disabled: ['format.link'],
      expect: 'app.palette',
      why: 'Ctrl+K opens the palette with nothing selected',
    },
    { chord: 'Ctrl+Shift+S', at: 'editor', expect: 'format.applyStyle', why: 'the Word set: Apply style' },
    {
      chord: 'Ctrl+Shift+S',
      at: 'editor',
      preset: 'onenote',
      expect: null,
      why: 'the OneNote set has no Apply style key',
    },
    {
      chord: 'Ctrl+-',
      at: 'editor',
      preset: 'onenote',
      expect: 'format.strikethrough',
      why: 'the OneNote set keeps its strikethrough key',
    },
    {
      chord: 'Alt+Shift+5',
      at: 'editor',
      preset: 'docs',
      expect: 'format.strikethrough',
      why: 'the Docs set: strikethrough',
    },
  ],
};
