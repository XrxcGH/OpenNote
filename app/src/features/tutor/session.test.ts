// @vitest-environment jsdom
// The tutor session's gates on the person's own key (ADR 0050). The fake shell records every cloud request. Work
// offline sends nothing and asks nothing, and nothing leaves before the consent card is answered yes. What is sent is
// the text the card showed.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../app/flags';
import { resetStores } from '../../state/store';
import { privacyStore } from '../diagnostics';
import { loadApi, loadTesting } from '../intel';
import { loadMathKit } from './kit';
import { answerConsentCard, askTutor, endSession, nextHint, setContext, tutorState } from './session';

// Built from pieces, so the source holds nothing shaped like a key.
const KEY = ['test', 'only', '0123456789', 'abcdef'].join('-');

type TestHost = Awaited<ReturnType<Awaited<ReturnType<typeof loadTesting>>['installTestHost']>>;
// Where the shell keeps each feature's choice of device or cloud.
const CHOICES_FILE = 'cloud-choices.json';

let host: TestHost;

beforeAll(async () => {
  await loadMathKit();
}, 120_000);

beforeEach(async () => {
  resetStores();
  initFlags('dev');
  host = (await loadTesting()).installTestHost();
  const api = await loadApi();
  await api.loadIntel();
  host.transport.ext.handle({ method: 'cloud.setKey', params: { feature: 'tutor', key: KEY } });
  host.transport.ext.files.set(CHOICES_FILE, JSON.stringify({ tutor: 'cloud' }));
  await api.loadCloud(true);
  endSession();
  setContext('2x + 3 = 7');
});

afterEach(() => endSession());

const offline = (on: boolean) => privacyStore.set((state) => ({ ...state, workOffline: on }));

describe('the tutor with a cloud key', () => {
  it('sends nothing and asks nothing while Work offline is on', async () => {
    offline(true);
    await nextHint();
    expect(host.transport.ext.cloudSent).toEqual([]);
    const state = tutorState.get();
    expect(state.consent).toBeNull();
    expect(state.offlineNote).toBe(true);
    expect(state.turns.at(-1)).toMatchObject({ who: 'tutor', where: 'rules' });
  });

  it('sends nothing until the card is answered yes, then exactly the text it showed', async () => {
    offline(false);
    const hint = nextHint();
    await vi.waitFor(() => expect(tutorState.get().consent).not.toBeNull());
    expect(host.transport.ext.cloudSent).toEqual([]);
    const shown = tutorState.get().consent;
    answerConsentCard(true);
    await hint;
    expect(host.transport.ext.cloudSent).toHaveLength(1);
    // The fake shell records "system | prompt"; the card shows "system", a blank line, and "prompt".
    const [system, prompt] = (host.transport.ext.cloudSent[0] ?? '').split(' | ');
    expect(shown?.text).toBe(`${system}\n\n${prompt}`);
    const turn = tutorState.get().turns.at(-1);
    expect(turn).toMatchObject({ where: 'cloud', host: shown?.host });
    expect(turn?.host).toBeTruthy();
  });

  it('asks again, showing the question, before a typed question goes', async () => {
    offline(false);
    const hint = nextHint();
    await vi.waitFor(() => expect(tutorState.get().consent).not.toBeNull());
    answerConsentCard(true);
    await hint;
    expect(host.transport.ext.cloudSent).toHaveLength(1);
    // The next hint on the same text is covered by that yes.
    await nextHint();
    expect(host.transport.ext.cloudSent).toHaveLength(2);
    const question = 'Why did the 3 change sides?';
    const asked = askTutor(question);
    await vi.waitFor(() => expect(tutorState.get().consent?.text).toContain(question));
    expect(host.transport.ext.cloudSent).toHaveLength(2);
    answerConsentCard(false);
    await asked;
    expect(host.transport.ext.cloudSent).toHaveLength(2);
    expect(tutorState.get().turns.at(-1)).toMatchObject({ who: 'tutor', where: 'rules' });
    // A yes to a question sends exactly what the card showed.
    const again = askTutor('What should I do first?');
    await vi.waitFor(() => expect(tutorState.get().consent?.text).toContain('What should I do first?'));
    const shown = tutorState.get().consent?.text;
    answerConsentCard(true);
    await again;
    expect(host.transport.ext.cloudSent).toHaveLength(3);
    const [system, prompt] = (host.transport.ext.cloudSent[2] ?? '').split(' | ');
    expect(shown).toBe(`${system}\n\n${prompt}`);
  });

  it('sends nothing when the card is answered no', async () => {
    offline(false);
    const hint = nextHint();
    await vi.waitFor(() => expect(tutorState.get().consent).not.toBeNull());
    answerConsentCard(false);
    await hint;
    expect(host.transport.ext.cloudSent).toEqual([]);
    expect(tutorState.get().turns.at(-1)).toMatchObject({ where: 'rules' });
  });
});
