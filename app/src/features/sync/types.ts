// What the Sync page and the title bar read from the shell's `sync_call` (app/src-tauri/src/e2e_sync.rs). The
// shell never sends a key: a recovery key comes back once, from setUp, and a pairing code from pairingCode.

export type SyncState = 'off' | 'synced' | 'syncing' | 'paused' | 'offline' | 'waiting' | 'error';

export type SyncErrorCode =
  | 'wrongSecret'
  | 'noVault'
  | 'vaultExists'
  | 'tampered'
  | 'rollback'
  | 'incomplete'
  | 'removed'
  | 'pairingExpired'
  | 'storage'
  | 'local'
  | 'weakPassphrase'
  | 'newer'
  | 'interrupted'
  | 'paused'
  | 'offline'
  | 'unknown';

export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  errorCode: SyncErrorCode | null;
  error: string | null;
  conflicts: number;
}

export type BackendConfig = { kind: 'folder'; path: string } | { kind: 'webdav'; url: string; username: string };

export interface SyncView {
  configured: boolean;
  status: SyncStatus;
  backend: BackendConfig | null;
  deviceName: string | null;
  fingerprint: string | null;
  /** Only in the answer to setUp, once. */
  recoveryKey?: string;
  /** Set up here, and the recovery key not checked yet: sync waits until it is. */
  unfinished?: boolean;
}

export interface Conflict {
  path: string;
  keptAs: string;
}

export interface Summary {
  upload: string[];
  download: string[];
  delete: string[];
  conflicts: Conflict[];
  bytesUp: number;
  bytesDown: number;
}

export interface DeviceRow {
  tag: string;
  name: string;
  added: number;
  /** When it last synced, in Unix milliseconds; null before its first sync, or for a head older than this. */
  lastSync?: number | null;
  thisDevice: boolean;
}

export interface PairingCode {
  code: string;
  /** QR code rows of 1 (dark) and 0. */
  rows: string[];
  expires: number;
}

export interface BeginInput {
  backend: BackendConfig;
  deviceName: string;
  password?: string;
  passphrase?: string;
  code?: string;
  recoveryKey?: string;
}

/** The host side: the shell in the app, an in-memory fake on the web platform and in tests. */
export interface SyncClient {
  status(): Promise<SyncView>;
  setUp(input: BeginInput): Promise<SyncView>;
  join(input: BeginInput): Promise<SyncView>;
  syncNow(): Promise<{ summary: Summary; view: SyncView }>;
  preview(): Promise<{ summary: Summary }>;
  setPaused(paused: boolean): Promise<SyncView>;
  devices(): Promise<DeviceRow[]>;
  removeDevice(tag: string): Promise<SyncView>;
  pairingCode(): Promise<PairingCode>;
  trustStorage(): Promise<SyncView>;
  turnOff(): Promise<SyncView>;
  /** Ends setup once the recovery key was checked: sync starts. */
  finishSetUp(): Promise<SyncView>;
  /** Stops an unfinished setup, and takes away the new vault if nothing else uses it yet. */
  cancelSetUp(): Promise<SyncView>;
  /** Sets a new passphrase; the recovery key must open the vault. */
  changePassphrase(input: { recoveryKey: string; passphrase: string }): Promise<SyncView>;
}

/** A refusal from the host, with its code. */
export class SyncFailure extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SyncFailure';
  }
}

export const ERROR_CODES: readonly SyncErrorCode[] = [
  'wrongSecret',
  'noVault',
  'vaultExists',
  'tampered',
  'rollback',
  'incomplete',
  'removed',
  'pairingExpired',
  'storage',
  'local',
  'weakPassphrase',
  'newer',
  'interrupted',
  'paused',
  'offline',
];
