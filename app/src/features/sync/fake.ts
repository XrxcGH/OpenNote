// The in-memory sync host that the web platform, Playwright, and the tests use. It follows the shell's rules: a
// passphrase under 10 characters is refused, a recovery key is shown once, pairing codes work once, and Pause and
// Work offline stop a round. `?sync=on` starts it set up, with two devices and a change waiting.

import { SyncFailure } from './types';
import type { BeginInput, DeviceRow, PairingCode, Summary, SyncClient, SyncStatus, SyncView } from './types';

export interface FakeSyncOptions {
  /** Starts set up, with another device. */
  configured?: boolean;
  /** Reports Work offline, as the shell reads it. */
  offline?: () => boolean;
  /** The clock, in Unix milliseconds. */
  now?: () => number;
}

const EMPTY: Summary = { upload: [], download: [], delete: [], conflicts: [], bytesUp: 0, bytesDown: 0 };
const IDLE: SyncStatus = { state: 'off', lastSync: null, errorCode: null, error: null, conflicts: 0 };
const PASSPHRASE = 'correct horse battery';
const RECOVERY = 'TEST-ONLY-FAKE-0000-1111-2222-3333-4444-5555-6666-7777-8888-9999';
const DAY = 86_400_000;

/** A 21 by 21 test pattern in the place of a QR code: the fake has no encoder, and nothing scans it. */
function rows(code: string): string[] {
  return Array.from({ length: 21 }, (_, y) =>
    Array.from({ length: 21 }, (_, x) => ((x * 7 + y * 3 + code.length) % 5 < 2 ? '1' : '0')).join(''),
  );
}

class FakeSync implements SyncClient {
  private view: SyncView | null = null;
  private current: SyncStatus = IDLE;
  private rows: DeviceRow[] = [];
  private codes = new Set<string>();
  private pending: Summary = EMPTY;
  private paused = false;
  private unfinished = false;
  private made = 0;

  constructor(
    private readonly now: () => number,
    private readonly offline: () => boolean,
    configured: boolean,
  ) {
    if (configured) this.seed();
  }

  private seed(): void {
    this.view = {
      configured: true,
      status: IDLE,
      backend: { kind: 'folder', path: 'C:\\Users\\Sam\\OneDrive\\OpenNote Sync' },
      deviceName: 'Surface Laptop',
      fingerprint: 'K7Q2-M9XA',
    };
    this.rows = [
      { tag: 'a1', name: 'Desktop', added: this.now() - DAY * 9, lastSync: this.now() - 600_000, thisDevice: false },
      { tag: 'b2', name: 'Surface Laptop', added: this.now() - DAY * 2, thisDevice: true },
    ];
    this.current = { ...IDLE, state: 'synced', lastSync: this.now() - 120_000 };
    this.pending = { ...EMPTY, download: ['Biology/s/p/page.json'], bytesDown: 12_480 };
  }

  private snapshot(): SyncView {
    if (!this.view) return { configured: false, status: IDLE, backend: null, deviceName: null, fingerprint: null };
    let state = this.current.state;
    if (this.paused) state = 'paused';
    else if (this.offline()) state = 'offline';
    return { ...this.view, recoveryKey: undefined, unfinished: this.unfinished, status: { ...this.current, state } };
  }

  private need(): void {
    if (!this.view) throw new SyncFailure('noVault');
  }

  private canRun(): void {
    this.need();
    if (this.paused) throw new SyncFailure('paused');
    if (this.offline()) throw new SyncFailure('offline');
  }

  private begin(input: BeginInput, tag: string): SyncView {
    if (this.view) throw new SyncFailure('vaultExists');
    const deviceName = input.deviceName.trim() || 'This PC';
    this.view = { configured: true, status: IDLE, backend: input.backend, deviceName, fingerprint: 'K7Q2-M9XA' };
    this.rows = [
      ...this.rows.filter((d) => !d.thisDevice),
      { tag, name: deviceName, added: this.now(), thisDevice: true },
    ];
    this.current = { ...IDLE, state: 'waiting' };
    return this.snapshot();
  }

  async status(): Promise<SyncView> {
    return this.snapshot();
  }

  async setUp(input: BeginInput): Promise<SyncView> {
    if ((input.passphrase ?? '').length < 10) throw new SyncFailure('weakPassphrase');
    this.begin(input, 'b2');
    this.unfinished = true;
    this.paused = true;
    return { ...this.snapshot(), recoveryKey: RECOVERY };
  }

  async finishSetUp(): Promise<SyncView> {
    this.need();
    this.unfinished = false;
    this.paused = false;
    return this.snapshot();
  }

  async cancelSetUp(): Promise<SyncView> {
    if (!this.unfinished) throw new SyncFailure('unknown');
    this.unfinished = false;
    return this.turnOff();
  }

  async join(input: BeginInput): Promise<SyncView> {
    const known =
      (input.code !== undefined && this.codes.delete(input.code.trim().toUpperCase())) ||
      input.passphrase === PASSPHRASE ||
      input.recoveryKey?.replace(/\s/g, '').toUpperCase() === RECOVERY;
    if (!known) throw new SyncFailure(input.code ? 'pairingExpired' : 'wrongSecret');
    return this.begin(input, 'c3');
  }

  async syncNow(): Promise<{ summary: Summary; view: SyncView }> {
    this.canRun();
    const summary = this.pending;
    this.pending = EMPTY;
    this.current = { ...IDLE, state: 'synced', lastSync: this.now(), conflicts: summary.conflicts.length };
    return { summary, view: this.snapshot() };
  }

  async preview(): Promise<{ summary: Summary }> {
    this.canRun();
    return { summary: this.pending };
  }

  async setPaused(paused: boolean): Promise<SyncView> {
    this.need();
    this.paused = paused;
    return this.snapshot();
  }

  async devices(): Promise<DeviceRow[]> {
    this.need();
    return this.rows.map((d) => ({ ...d }));
  }

  async removeDevice(tag: string): Promise<SyncView> {
    this.need();
    this.rows = this.rows.filter((d) => d.tag !== tag || d.thisDevice);
    return this.snapshot();
  }

  async pairingCode(): Promise<PairingCode> {
    this.need();
    this.made += 1;
    const code = `PAIR-CODE-${String(this.made).padStart(4, '0')}-TEST-ONLY-0000`;
    this.codes.add(code);
    return { code, rows: rows(code), expires: this.now() + DAY };
  }

  async trustStorage(): Promise<SyncView> {
    this.need();
    this.current = { ...this.current, state: 'waiting', errorCode: null, error: null };
    return this.snapshot();
  }

  async turnOff(): Promise<SyncView> {
    this.view = null;
    this.unfinished = false;
    this.paused = false;
    this.codes = new Set();
    this.current = IDLE;
    return this.snapshot();
  }
}

export function createFakeSync(options: FakeSyncOptions = {}): SyncClient {
  return new FakeSync(options.now ?? (() => Date.now()), options.offline ?? (() => false), options.configured ?? false);
}

/** The fake's passphrase and recovery key, for tests and Playwright. */
export const FAKE_SECRETS = { passphrase: PASSPHRASE, recoveryKey: RECOVERY } as const;
