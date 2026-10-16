// Runs one Zotero command: the shell connects to Zotero and hands over each call it makes; the bridge answers it on
// the page; the shell passes the answer back. The two ends are a small interface so the whole exchange can be tried
// against a pretend Zotero.
import { ZoteroBridge } from './bridge';
import type { Host, Prefs } from './bridge';

/** The commands Zotero's menu offers a word processor that OpenNote uses. */
export type ZoteroCommand = 'addEditCitation' | 'addEditBibliography' | 'refresh' | 'removeCodes' | 'setDocPrefs';

export interface ZoteroCall {
  txid: number;
  method: string;
  args: unknown[];
}

export interface Outcome {
  calls: number;
  completed: boolean;
  errors: number;
}

/** The shell side. `run` rejects with an object whose `code` is `zoteroMissing` when Zotero is not running. */
export interface Transport {
  run(command: ZoteroCommand, onCall: (call: ZoteroCall) => void): Promise<Outcome>;
  reply(txid: number, ok: boolean, value: unknown): Promise<unknown>;
}

export async function tauriTransport(): Promise<Transport> {
  const { Channel, invoke } = await import('@tauri-apps/api/core');
  return {
    run(command, onCall) {
      const calls = new Channel<ZoteroCall>();
      calls.onmessage = onCall;
      // A window that closes or reloads can no longer answer, so the shell stops waiting for it.
      const abandon = () => void invoke('study_zotero_cancel').catch(() => undefined);
      window.addEventListener('pagehide', abandon);
      return invoke<Outcome>('study_zotero_run', { command, calls }).finally(() =>
        window.removeEventListener('pagehide', abandon),
      );
    },
    reply: (txid, ok, value) => invoke('study_zotero_reply', { txid, ok, value }),
  };
}

export type RunResult = { status: 'done' | 'cancelled'; errors: number } | { status: 'missing' | 'failed' };

/** Runs `command` with Zotero, answering its calls against `host`. Never throws: a missing Zotero is a status. */
export async function runZotero(
  command: ZoteroCommand,
  host: Host,
  prefs: Prefs,
  transport: Transport,
): Promise<RunResult> {
  const bridge = new ZoteroBridge(host, prefs);
  let chain: Promise<unknown> = Promise.resolve();
  const answer = async (call: ZoteroCall) => {
    try {
      const value = await bridge.handle(call.method, call.args);
      await transport.reply(call.txid, true, value ?? null);
    } catch (error) {
      await transport.reply(call.txid, false, error instanceof Error ? error.message : 'failed');
    }
  };
  try {
    const outcome = await transport.run(command, (call) => {
      chain = chain.then(() => answer(call));
    });
    await chain;
    return { status: outcome.completed ? 'done' : 'cancelled', errors: outcome.errors };
  } catch (error) {
    return { status: (error as { code?: string } | null)?.code === 'zoteroMissing' ? 'missing' : 'failed' };
  } finally {
    bridge.sweep();
  }
}
