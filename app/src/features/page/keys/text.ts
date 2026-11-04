// The keys of the text formatting commands, one table part spread into PAGE_KEYS (features/page/keys.ts).
// Owner: text:shortcuts (B10). text:scaffold wrote it empty, so lanes never edit keys.ts for these commands.
// Add entries as `'format.fontFamily': editor([...])`; the helpers live in keys.ts, so build each KeySpec literally.
import type { KeySpec } from '../keys';

export const TEXT_KEYS = {} as const satisfies Record<string, KeySpec>;
