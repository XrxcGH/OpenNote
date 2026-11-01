// On macOS and Linux the intelligence settings name the recognizer that system uses, never a Windows language
// pack, and offer no button to Windows Settings for text in pictures or handwriting.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../app/flags';
import { setHostSystem } from '../../platform/system';
import { expectNoAxeViolations, renderUi } from '../../test';
import { INTEL_FLAGS } from './flags';
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
    const lines = await screen.findAllByText(/^On, but not ready: Tesseract isn't installed\. Install the tesseract-ocr/);
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
