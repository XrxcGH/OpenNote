// On macOS and Linux the intelligence settings name the recognizer that system uses, never a Windows language
// pack, and offer no button to Windows Settings for text in pictures or handwriting.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../app/flags';
import { setHostSystem } from '../../platform/system';
import { IntelClientError } from '../../services/intel';
import { t } from '../../strings/t';
import { expectNoAxeViolations, renderUi } from '../../test';
import { INTEL_FLAGS } from './flags';
import { platformText } from './platformNeeds';
import { describeProblem } from './runtime';
import IntelSection from './SettingsSection';
import { installTestHost } from './testing';

const BUILDING_OFF = Object.fromEntries(INTEL_FLAGS.filter((one) => !one.enabled.stable).map((one) => [one.id, false]));

beforeEach(() => {
  initFlags('dev', BUILDING_OFF);
});

afterEach(() => {
  setHostSystem('windows');
});

describe('recognition settings on macOS and Linux', () => {
  it('asks for Tesseract on Linux, with no Windows button', async () => {
    setHostSystem('linux');
    installTestHost({ settings: { ocr: true, handwriting: true }, unavailable: ['ocr', 'handwriting'] });
    const { container } = renderUi(<IntelSection />);
    const lines = await screen.findAllByText(
      /^On, but not ready: Tesseract isn't installed\. Install the tesseract-ocr/,
    );
    expect(lines).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Open Windows language settings' })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('names Vision on a Mac, and keeps the Windows text for read aloud', async () => {
    setHostSystem('macos');
    installTestHost({ settings: { ocr: true, readAloud: true }, unavailable: ['ocr', 'readAloud'] });
    renderUi(<IntelSection />);
    await screen.findByText("On, but not ready: this Mac's text recognition didn't start. It needs macOS 11 or later.");
    expect(screen.getByText('On, but not ready: Windows has no voice installed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open Windows/ })).toBeNull();
  });
});

describe('the offers, help and problems off Windows', () => {
  const NAMING_WINDOWS = [
    'intel.offer.ocr',
    'intel.offer.handwriting',
    'intel.settings.handwriting.help',
    'intel.problems.languageUnavailable',
    'intel.problems.handwritingUnavailable',
  ] as const;

  it('keep the Windows sentences on Windows', () => {
    for (const key of NAMING_WINDOWS) expect(platformText(key)).toBe(key);
  });

  it('name Vision on a Mac and Tesseract on Linux, never Windows', () => {
    for (const [system, engine] of [
      ['macos', 'Vision'],
      ['linux', 'Tesseract'],
    ] as const) {
      setHostSystem(system);
      for (const key of NAMING_WINDOWS) {
        const text = t(platformText(key));
        expect(text, `${system} ${key}`).toContain(engine);
        expect(text, `${system} ${key}`).not.toContain('Windows');
      }
    }
    expect(platformText('intel.offer.readAloud')).toBe('intel.offer.readAloud');
  });

  it('tell Linux to install a language pack, with no Windows button', () => {
    setHostSystem('linux');
    const problem = describeProblem(new IntelClientError('languageUnavailable', 'none'), 'image');
    expect(problem.message).toBe('Tesseract has no language pack installed. Install one, such as tesseract-ocr-eng.');
    expect(problem.action).toBeUndefined();
  });

  it('show the Mac help line in the settings', async () => {
    setHostSystem('macos');
    installTestHost({ settings: { handwriting: true } });
    renderUi(<IntelSection />);
    expect(await screen.findByText(/using Apple's Vision on this Mac\. Runs on this device/)).toBeTruthy();
  });
});
