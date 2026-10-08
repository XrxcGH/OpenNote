// Settings, then On-device intelligence: a switch for each feature, off at first. Each says what it does and that
// it runs on this device. A missing language pack or voice gets a plain message with the way to fix it.
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../app/flags';
import { expectNoAxeViolations, renderUi } from '../../test';
import { INTEL_FLAGS } from './flags';
import IntelSection from './SettingsSection';
import { installTestHost } from './testing';
import type { TestHost } from './testing';

let host: TestHost;
/** The flags of features still being built, all off, so the section shows what Stable has. */
const BUILDING_OFF = Object.fromEntries(INTEL_FLAGS.filter((one) => !one.enabled.stable).map((one) => [one.id, false]));

beforeEach(() => {
  initFlags('dev', BUILDING_OFF);
  host = installTestHost();
});

const switchNamed = (name: string) => screen.findByRole('switch', { name });

describe('the On-device intelligence section', () => {
  it('has a switch for each feature that is built, all off', async () => {
    renderUi(<IntelSection />);
    for (const name of ['Text in images', 'Read aloud', 'Summaries and keywords']) {
      expect((await switchNamed(name)).getAttribute('aria-checked')).toBe('false');
    }
    expect(screen.queryByRole('switch', { name: 'Handwriting' })).toBeNull();
    expect(screen.getAllByText('Off')).toHaveLength(3);
  });

  it('says on every feature that it runs on this device', async () => {
    renderUi(<IntelSection />);
    await switchNamed('Read aloud');
    expect(screen.getAllByText(/Runs on this device\. Nothing leaves it\./)).toHaveLength(3);
    expect(screen.getByText(/Nothing is sent anywhere\. Each one stays off until you turn it on\./)).toBeTruthy();
  });

  it('shows Handwriting once its flag is on', async () => {
    initFlags('dev', BUILDING_OFF, { 'intel.handwriting': true });
    renderUi(<IntelSection />);
    expect((await switchNamed('Handwriting')).getAttribute('aria-checked')).toBe('false');
  });

  it('shows Transcription once its flag is on, and says when no speech model is downloaded', async () => {
    initFlags('dev', BUILDING_OFF, { 'intel.transcription': true });
    host = installTestHost({ settings: { transcription: true }, unavailable: ['transcription'] });
    renderUi(<IntelSection />);
    expect((await switchNamed('Transcription')).getAttribute('aria-checked')).toBe('true');
    await screen.findByText(/On, but not ready: no speech model is downloaded yet/);
  });

  it('turns a feature on and saves it, then says it is ready', async () => {
    renderUi(<IntelSection />);
    await userEvent.click(await switchNamed('Text in images'));
    await waitFor(() => expect(host.saved).toEqual([{ ocr: true }]));
    expect((await switchNamed('Text in images')).getAttribute('aria-checked')).toBe('true');
    await screen.findByText('On and ready');
  });

  it('turns a feature off again', async () => {
    host = installTestHost({ settings: { summaries: true } });
    renderUi(<IntelSection />);
    const toggle = await switchNamed('Summaries and keywords');
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    await userEvent.click(toggle);
    await waitFor(() => expect(host.saved).toEqual([{ summaries: false }]));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('says what is missing, and offers the Windows page that adds it', async () => {
    host = installTestHost({ settings: { readAloud: true, ocr: true }, unavailable: ['readAloud', 'ocr'] });
    renderUi(<IntelSection />);
    await screen.findByText('On, but not ready: Windows has no voice installed.');
    expect(screen.getByText('On, but not ready: Windows has no text recognition language installed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Windows speech settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Windows language settings' })).toBeTruthy();
  });

  it('puts the switch back and says so when the choice cannot be saved', async () => {
    renderUi(<IntelSection />);
    const toggle = await switchNamed('Read aloud');
    host.failNextSave();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('gives each switch its help and status as its description, with no accessibility violations', async () => {
    renderUi(
      <main>
        <IntelSection />
      </main>,
    );
    const toggle = await switchNamed('Text in images');
    const described = (toggle.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id));
    expect(described.map((one) => one?.textContent)).toEqual([
      expect.stringContaining('Finds words in pictures and screenshots'),
      'Off',
    ]);
    expect(within(screen.getByRole('list', { name: 'On-device intelligence' })).getAllByRole('listitem')).toHaveLength(
      3,
    );
    await expectNoAxeViolations(document.body);
  });
});
