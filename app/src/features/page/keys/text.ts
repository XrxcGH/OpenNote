// The keys of the text formatting commands, one table part spread into PAGE_KEYS (features/page/keys.ts).
// Owner: text:shortcuts (B10). text:scaffold wrote it empty, so lanes never edit keys.ts for these commands.
// Add entries as literal KeySpecs, for example `'format.fontFamily': { keys: ['Ctrl+Shift+F'], scope: 'editor' }`.
import type { KeySpec } from '../keys';

export const TEXT_KEYS = {} as const satisfies Record<string, KeySpec>;
