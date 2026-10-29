import { describe, expect, it } from 'vitest';
import { DiagnosticsError } from './client';
import { accepted, declined } from './consent';
import { CLOSED, reduceReview, sendRequest } from './crashReview';
import { EXAMPLE_REPORT, createFakeDiagnostics, fakeReport } from './fake';
import { DEFAULT_OPTIONS } from './feedback';

const NOW = 1_790_000_000;
const ENDPOINT = 'https://crashes.example.org/report';

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DiagnosticsError) return error.code;
    throw error;
  }
  return 'resolved';
}

function world(over: Parameters<typeof createFakeDiagnostics>[0] = {}) {
  return createFakeDiagnostics({
    consent: accepted(NOW),
    endpoint: ENDPOINT,
    reports: [fakeReport('crash-100-0', 100), fakeReport('crash-200-0', 200)],
    ...over,
  });
}

describe('the fake host follows the rules of the real one', () => {
  it('starts with nothing decided, and stores the decision', async () => {
    const { client } = createFakeDiagnostics();
    expect((await client.consent()).decision).toBe('unasked');
    await client.setConsent(declined(NOW));
    expect((await client.consent()).decision).toBe('declined');
  });

  it('lists the newest report first', async () => {
    expect((await world().client.listReports()).map((r) => r.id)).toEqual(['crash-200-0', 'crash-100-0']);
  });

  it('prepares nothing without a current yes, an address, or the report', async () => {
    expect(
      await code(
        createFakeDiagnostics({
          consent: declined(NOW),
          endpoint: ENDPOINT,
          reports: [fakeReport('a', 1)],
        }).client.prepareReport('a'),
      ),
    ).toBe('notOptedIn');
    expect(await code(world({ endpoint: '  ' }).client.prepareReport('crash-100-0'))).toBe('noAddress');
    expect(await code(world().client.prepareReport('crash-9-9'))).toBe('missing');
  });

  it('sends the report it prepared, once the person has read it, and nothing else', async () => {
    const { client, sent } = world();
    let state = reduceReview(CLOSED, { type: 'open', id: 'crash-200-0' });
    const pending = await client.prepareReport('crash-200-0');
    expect(pending.payload).toContain('"format": 1');
    state = reduceReview(state, { type: 'prepared', pending });
    state = reduceReview(state, { type: 'send' });
    const request = sendRequest(state);
    expect(request).not.toBeNull();
    await client.sendReport(request?.id ?? '', request?.digest ?? '');
    expect(sent).toEqual([pending.payload]);
  });

  it('refuses a digest of anything else', async () => {
    const { client, sent } = world();
    expect(await code(client.sendReport('crash-200-0', 'not-the-digest'))).toBe('notReviewed');
    expect(sent).toEqual([]);
  });

  it('fails a send when asked to, and sends again after', async () => {
    const fake = world({ failNextSend: true });
    const pending = await fake.client.prepareReport('crash-100-0');
    expect(await code(fake.client.sendReport(pending.id, pending.digest))).toBe('io');
    expect(await code(fake.client.sendReport(pending.id, pending.digest))).toBe('resolved');
    expect(fake.sent).toHaveLength(1);
  });

  it('deletes one report or all of them', async () => {
    const { client, state } = world();
    await client.deleteReport('crash-100-0');
    expect(state.reports).toHaveLength(1);
    expect(await code(client.deleteReport('crash-100-0'))).toBe('missing');
    expect(await client.deleteAllReports()).toBe(1);
    expect(state.reports).toEqual([]);
  });

  it('shows an example report in the real format', async () => {
    const example = await world().client.exampleReport();
    expect(example).toBe(EXAMPLE_REPORT);
    expect(example.frames.every((f) => !f.module.includes('\\') && !f.module.includes('/'))).toBe(true);
    expect(JSON.stringify(example)).not.toMatch(/Users|Documents/);
  });
});

describe('the fake feedback file', () => {
  it('builds the file the options ask for, and saves exactly the text that was built', async () => {
    const fake = world();
    const { bundle, review } = await fake.client.buildFeedback({
      ...DEFAULT_OPTIONS,
      description: 'It crashed.',
      includeCrashReports: true,
    });
    expect(bundle.sections.map((s) => s.id)).toEqual(['description', 'system', 'selfCheck', 'logs', 'crashReports']);
    const saved = await fake.client.saveFeedback(review.digest);
    expect(saved.name).toBe(review.suggestedFileName);
    expect(fake.saved).toEqual([review.text]);
  });

  it('leaves out crash reports and logs unless they are chosen', async () => {
    const { bundle } = await world().client.buildFeedback({
      description: '',
      includeLogs: false,
      includeCrashReports: false,
    });
    expect(bundle.sections.map((s) => s.id)).toEqual(['system', 'selfCheck']);
  });

  it('refuses a digest of other text, and a save before any build', async () => {
    const fake = world();
    expect(await code(fake.client.saveFeedback('x'))).toBe('notReviewed');
    const first = await fake.client.buildFeedback(DEFAULT_OPTIONS);
    await fake.client.buildFeedback({ ...DEFAULT_OPTIONS, description: 'changed' });
    expect(await code(fake.client.saveFeedback(first.review.digest))).toBe('notReviewed');
    expect(fake.saved).toEqual([]);
  });

  it('fails a save when asked to', async () => {
    const fake = world({ failNextSave: true });
    const { review } = await fake.client.buildFeedback(DEFAULT_OPTIONS);
    expect(await code(fake.client.saveFeedback(review.digest))).toBe('io');
    expect(await code(fake.client.saveFeedback(review.digest))).toBe('resolved');
  });
});
