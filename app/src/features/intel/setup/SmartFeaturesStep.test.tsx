// The smart features step (A1-33): Recommended names transcription only when this build can run it, and Custom
// lets each of transcription and summaries run on this device or with the person's own key, which is saved only
// after they confirm what is sent and where.
import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../../app/flags';
import type { SetupDraft } from '../../../registries';
import { resetStores } from '../../../state/store';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { CHOICES_FILE } from '../cloud/store';
import { installTestHost } from '../testing';
import type { TestHost } from '../testing';
import SmartFeaturesStep from './SmartFeaturesStep';

const KEY = ['test', 'only', '0123456789', 'abcdef'].join('-');
let host: TestHost;

function Step() {
  const [draft, setDraft] = useState<SetupDraft>({});
  return (
    <SmartFeaturesStep
      draft={draft}
      setDraft={(patch) => setDraft((old) => ({ ...old, ...patch }))}
      stepIndex={2}
      stepCount={4}
      titleId="smart-title"
      progressId="smart-progress"
    />
  );
}

beforeEach(() => {
  resetStores();
  initFlags('dev');
  host = installTestHost();
});

describe('Recommended', () => {
  it('names transcription when the speech engine is built', async () => {
    renderUi(<Step />);
    await screen.findByText(/Transcription, handwriting recognition/);
  });

  it('leaves transcription out when there is no speech engine', async () => {
    initFlags('dev', { 'intel.transcription': false });
    renderUi(<Step />);
    await screen.findByText(/^Handwriting recognition, text in images, and summaries/);
    expect(screen.queryByText(/Transcription, handwriting recognition/)).toBeNull();
  });
});

describe('Custom with a cloud key', () => {
  async function openSummaries() {
    renderUi(
      <main>
        <Step />
      </main>,
    );
    await userEvent.click(await screen.findByRole('radio', { name: /Custom/ }));
    await userEvent.click(await screen.findByRole('switch', { name: 'Use summaries and keywords' }));
    return screen.findByRole('radiogroup', { name: 'Where summaries and keywords runs' });
  }

  it('keeps every feature on this device until a key is chosen', async () => {
    await openSummaries();
    expect(screen.getByRole('radio', { name: /On this device/ }).getAttribute('aria-checked')).toBe('true');
    await screen.findByText(/Everything runs on this device/);
    await expectNoAxeViolations(document.body);
  });

  it('saves a key only after the person confirms, then forgets the typed text', async () => {
    await openSummaries();
    await userEvent.click(screen.getByRole('radio', { name: /With my own key/ }));
    await screen.findByText(/sent to api\.openai\.com with your key/);
    const field = await screen.findByLabelText('Key for summaries and keywords');
    expect(field.getAttribute('type')).toBe('password');
    await userEvent.type(field, KEY);
    await userEvent.click(screen.getByRole('button', { name: 'Save key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send this to a cloud service?' });
    expect(dialog.textContent).toContain('api.openai.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save key and use it' }));
    await screen.findByText('A key is saved in Windows Credential Manager.');
    expect(host.transport.ext.cloudKeys.has('summaries')).toBe(true);
    expect(JSON.parse(host.transport.ext.files.get(CHOICES_FILE) ?? '{}')).toMatchObject({ summaries: 'cloud' });
    expect(document.body.textContent).not.toContain(KEY);
    await screen.findByText(/The features you gave your own key send their input/);
    await userEvent.click(screen.getByRole('button', { name: 'Forget the key for summaries and keywords' }));
    await waitFor(() => expect(host.transport.ext.cloudKeys.has('summaries')).toBe(false));
  });

  it('keeps the feature here when the person says no', async () => {
    await openSummaries();
    await userEvent.click(screen.getByRole('radio', { name: /With my own key/ }));
    await userEvent.type(await screen.findByLabelText('Key for summaries and keywords'), KEY);
    await userEvent.click(screen.getByRole('button', { name: 'Save key' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it on this device' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(host.transport.ext.cloudKeys.size).toBe(0);
    expect(host.transport.ext.files.has(CHOICES_FILE)).toBe(false);
  });
});
