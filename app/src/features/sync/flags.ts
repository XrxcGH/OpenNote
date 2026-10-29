// The flag of optional end-to-end-encrypted sync (ADR 0049). Settings > Sync shows in development, nightly, and Beta
// builds, labeled Beta; sync itself stays off until the person sets it up there. Stable builds hide it until the
// owner reviews the design. app/flags.ts joins this list to the others.
import type { FlagDef, FlagId } from '../../app/flags';

export type SyncFlagId = Extract<FlagId, `sync.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';

export const SYNC_FLAGS: readonly FlagDef[] = [
  {
    id: 'sync.e2ee',
    description: 'Settings > Sync: optional end-to-end-encrypted sync through a folder or a WebDAV server.',
    issue: `${ISSUES}${encodeURIComponent('sync.e2ee')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
