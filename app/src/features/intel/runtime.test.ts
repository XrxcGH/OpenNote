// The choices: everything starts off, a save shows at once and is undone when it fails, and each problem a person can
// hit (no language pack, no voice) is told in the words of the interface with the place to fix it.
import { beforeEach, describe, expect, it } from 'vitest';
import { IntelClientError } from '../../services/intel';
import { intelState, isOn } from './choices';
import { describeProblem, loadIntel, onChoiceChange, refreshStatus, setFeature } from './runtime';
import { installTestHost } from './testing';

beforeEach(() => void installTestHost());

describe('the choices', () => {
  it('start with every feature off', async () => {
    await loadIntel();
    expect(intelState.get().loaded).toBe(true);
    expect(Object.values(intelState.get().choices).some(Boolean)).toBe(false);
  });

  it('read what the host saved', async () => {
    installTestHost({ settings: { summaries: true } });
    await loadIntel();
    expect(isOn('summaries')).toBe(true);
    expect(isOn('ocr')).toBe(false);
  });

  it('save one feature at a time and tell the listeners', async () => {
    const host = installTestHost();
    const heard: string[] = [];
    onChoiceChange((feature, on) => heard.push(`${feature}:${on}`));
    await setFeature('ocr', true);
    expect(host.saved).toEqual([{ ocr: true }]);
    expect(isOn('ocr')).toBe(true);
    expect(heard).toEqual(['ocr:true']);
    await setFeature('ocr', true);
    expect(host.saved).toHaveLength(1);
  });

  it('go back to the saved choice when saving fails', async () => {
    const host = installTestHost();
    host.failNextSave();
    await expect(setFeature('readAloud', true)).rejects.toThrow('disk is full');
    expect(isOn('readAloud')).toBe(false);
  });

  it('say when a feature is on but missing what it needs', async () => {
    installTestHost({ settings: { ocr: true }, unavailable: ['ocr'] });
    await loadIntel();
    await refreshStatus();
    const status = intelState.get().status?.find((one) => one.feature === 'ocr');
    expect(status).toMatchObject({ enabled: true, available: false });
  });
});

describe('describeProblem', () => {
  it('names a missing voice and offers the speech settings', () => {
    const { message, action } = describeProblem(new IntelClientError('voiceUnavailable', 'none'), 'speech');
    expect(message).toBe('Windows has no voice installed.');
    expect(action?.label).toBe('Open Windows speech settings');
  });

  it('names a missing language pack and offers the language settings', () => {
    const { message, action } = describeProblem(new IntelClientError('languageUnavailable', 'none'), 'image');
    expect(message).toBe('Windows has no text recognition language installed.');
    expect(action?.label).toBe('Open Windows language settings');
  });

  it('says handwriting recognition is missing for handwriting', () => {
    const { message } = describeProblem(new IntelClientError('languageUnavailable', 'none'), 'handwriting');
    expect(message).toBe('Windows has no handwriting recognition installed.');
  });

  it('gives a plain message for anything else, without the engine words', () => {
    expect(describeProblem(new Error('0x80070005'), 'text')).toEqual({ message: "Couldn't do that. Try again." });
    expect(describeProblem(new IntelClientError('unsupported', 'x'), 'text').message).toBe(
      "This isn't available on this computer.",
    );
  });
});
