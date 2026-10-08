// The web platform's diagnostics (Phase 13): the in-memory host from the diagnostics feature, with a self-check
// that has something to show. Playwright reaches every state through the address:
//   ?crashes=2          two crashes in a row, so safe start is offered
//   ?crashes=3&safe=1   a crash even in safe mode
//   ?consent=accepted   crash reports already on, with two saved reports and an address
//   ?offline            Work offline is on
import { createFakeDiagnostics, fakeReport, passingSelfCheck } from '../../features/diagnostics';
import type { DiagnosticsClient } from '../../features/diagnostics';
import { registerTestHook } from './testHooks';

/** The in-memory host, shaped by the address (see the top of this file). */
export function createWebDiagnostics(
  search = typeof location === 'undefined' ? '' : location.search,
): DiagnosticsClient {
  const params = new URLSearchParams(search);
  const crashes = Number(params.get('crashes') ?? 0);
  const accepted = params.get('consent') === 'accepted';
  const now = Math.floor(Date.now() / 1000);
  const fake = createFakeDiagnostics({
    selfCheck: passingSelfCheck(now),
    workOffline: params.has('offline'),
    startup: {
      report: {
        previous: crashes > 0 ? 'crashed' : 'clean',
        crashesInARow: crashes,
        offerSafeMode: crashes >= 2,
        previousWasSafe: params.has('safe'),
      },
      safeMode: false,
      stats: { sessions: 10, clean: 9, crashed: 1 },
    },
    ...(accepted
      ? {
          consent: { decision: 'accepted' as const, wordingVersion: 1, decidedUnix: now },
          endpoint: 'https://reports.example.net/v1/crash',
          reports: [fakeReport('crash-2', now - 3600), fakeReport('crash-1', now - 86_400)],
        }
      : {}),
  });
  // What a spec reads: the calls the interface made, and the text it sent or saved. Nothing leaves the page.
  registerTestHook('diagnostics', () => ({
    calls: fake.calls,
    saved: fake.saved,
    sent: fake.sent,
    restarts: fake.state.restarts,
    consent: fake.state.consent,
  }));
  registerTestHook('diagnosticsFail', (what: 'send' | 'save' | 'cancel') => {
    if (what === 'send') fake.state.failNextSend = true;
    if (what === 'save') fake.state.failNextSave = true;
    if (what === 'cancel') fake.state.cancelNextSave = true;
  });
  return fake.client;
}
