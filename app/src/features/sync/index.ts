// Optional end-to-end-encrypted sync (ADR 0049): Settings > Sync, the title bar notice, and the commands. The shell
// side is app/src-tauri/src/e2e_sync.rs over the opennote-sync crate; the web platform and the tests use fake.ts.

export { createFakeSync, FAKE_SECRETS } from './fake';
export type { FakeSyncOptions } from './fake';
export { ERROR_CODES, SyncFailure } from './types';
export type * from './types';
