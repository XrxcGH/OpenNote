// Crash reports, the self-check, the feedback file, and safe start through the shell's commands (Phase 13). The
// shell refuses with a fixed code, and this turns it into the DiagnosticsError the screens read. It calls Tauri
// directly, so adding these commands never edits the shared command table in invoke.ts.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { DiagnosticsError } from '../../features/diagnostics';
import type { DiagnosticsClient, DiagnosticsErrorCode } from '../../features/diagnostics';
import { toIpcError } from './invoke';

const CODES: readonly DiagnosticsErrorCode[] = [
  'notOptedIn',
  'noAddress',
  'missing',
  'notReviewed',
  'io',
  'canceled',
  'offline',
];

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    const { code } = toIpcError(error);
    throw new DiagnosticsError(CODES.find((known) => known === code) ?? 'io');
  }
}

export function createTauriDiagnostics(): DiagnosticsClient {
  return {
    consent: () => call('crash_consent_get'),
    setConsent: (consent) => call<null>('crash_consent_set', { consent }).then(() => undefined),
    exampleReport: () => call('crash_example'),
    listReports: () => call('crash_list'),
    prepareReport: (id) => call('crash_prepare', { id }),
    sendReport: (id, digest) => call<null>('crash_send', { id, digest }).then(() => undefined),
    deleteReport: (id) => call<null>('crash_delete', { id }).then(() => undefined),
    deleteAllReports: () => call('crash_delete_all'),
    runSelfCheck: () => call('diagnostics_self_check'),
    buildFeedback: (options, facts) => call('diagnostics_build_feedback', { options, facts: facts ?? null }),
    saveFeedback: (digest) => call('diagnostics_save_feedback', { digest }),
    startup: () => call('diagnostics_startup'),
    enterSafeMode: () => call<null>('diagnostics_enter_safe_mode').then(() => undefined),
    restart: () => call<null>('diagnostics_restart').then(() => undefined),
    privacy: () => call('privacy_get'),
    setWorkOffline: (offline) => call<null>('privacy_set_offline', { offline }).then(() => undefined),
  };
}
