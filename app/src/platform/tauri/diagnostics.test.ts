// @vitest-environment jsdom
// The Tauri diagnostics client against Tauri's mockIPC: the command names, the argument shapes Rust reads, and
// the codes Rust refuses with, which become the DiagnosticsError the screens read.

import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiagnosticsError } from '../../features/diagnostics';
import { createTauriDiagnostics } from './diagnostics';

type Call = { command: string; args: unknown };

let calls: Call[];
let answers: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  answers = {};
  mockIPC((command, args) => {
    calls.push({ command, args });
    const answer = answers[command];
    if (typeof answer === 'object' && answer !== null && 'code' in answer) throw answer;
    return answer ?? null;
  });
});

afterEach(() => clearMocks());

const last = () => calls[calls.length - 1];

describe('the Tauri diagnostics client', () => {
  it('sends each call to its command with the arguments Rust reads', async () => {
    const client = createTauriDiagnostics();
    const consent = { decision: 'accepted', wordingVersion: 1, decidedUnix: 5 } as const;
    await client.setConsent(consent);
    expect(last()).toEqual({ command: 'crash_consent_set', args: { consent } });
    await client.prepareReport('crash-1');
    expect(last()).toEqual({ command: 'crash_prepare', args: { id: 'crash-1' } });
    await client.sendReport('crash-1', 'abc');
    expect(last()).toEqual({ command: 'crash_send', args: { id: 'crash-1', digest: 'abc' } });
    await client.deleteReport('crash-1');
    expect(last()).toEqual({ command: 'crash_delete', args: { id: 'crash-1' } });
    await client.saveFeedback('def');
    expect(last()).toEqual({ command: 'diagnostics_save_feedback', args: { digest: 'def' } });
    await client.setWorkOffline(true);
    expect(last()).toEqual({ command: 'privacy_set_offline', args: { offline: true } });
    await client.restart();
    expect(last().command).toBe('diagnostics_restart');
  });

  it('sends the options and the facts for the feedback file, and null facts when there are none', async () => {
    const client = createTauriDiagnostics();
    const options = { description: 'It jumped.', includeLogs: true, includeCrashReports: false };
    await client.buildFeedback(options);
    expect(last()).toEqual({ command: 'diagnostics_build_feedback', args: { options, facts: null } });
    const facts = {
      locale: 'en-US',
      displayScalePercent: 150,
      textSizePercent: 100,
      theme: 'dark',
      density: 'mouse',
      enabledFlags: ['privacy.panel'],
    };
    await client.buildFeedback(options, facts);
    expect(last()).toEqual({ command: 'diagnostics_build_feedback', args: { options, facts } });
  });

  it('returns what Rust answers', async () => {
    answers.crash_list = [{ id: 'a', time_unix: 1, kind: 'panic', app_version: '1.0.0', size_bytes: 10 }];
    answers.privacy_get = { workOffline: true, reportEndpoint: '', reportSentUnix: null };
    const client = createTauriDiagnostics();
    expect(await client.listReports()).toHaveLength(1);
    expect((await client.privacy()).workOffline).toBe(true);
  });

  it.each(['notOptedIn', 'noAddress', 'missing', 'notReviewed', 'io', 'canceled', 'offline'] as const)(
    'turns the refusal %s into a DiagnosticsError with that code',
    async (code) => {
      answers.crash_send = { code, message: code };
      const error = await createTauriDiagnostics()
        .sendReport('a', 'b')
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DiagnosticsError);
      expect((error as DiagnosticsError).code).toBe(code);
    },
  );

  it('reads any other failure as io, with no message that could hold private text', async () => {
    answers.crash_send = { code: 'internal', message: 'C:\\Users\\Someone\\notes\\secret.md' };
    const error = (await createTauriDiagnostics()
      .sendReport('a', 'b')
      .catch((caught: unknown) => caught)) as DiagnosticsError;
    expect(error.code).toBe('io');
    expect(error.message).not.toContain('Someone');
  });
});
