// Each subsystem gets the chosen language: spelling, text in pictures, handwriting, the voice, and hyphenation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntelClient } from '../../services/intel';
import { defaultBootData } from '../../boot/defaults';
import { createWebPlatform } from '../../platform/web';
import { setLocale } from '../../state/language';
import { initSettings, updateSettings } from '../../state/settings';
import { resetStores } from '../../state/store';
import { readTextInImage } from '../intel/imageText';
import { readHandwriting, registerInkStrokeSource } from '../intel/ink';
import { pickVoice } from '../page/readAloud/engine';
import { resetSpelling, spellingEngine } from '../page/spelling/current';
import { breakText, syllables } from '../pages/reading';
import { otherLanguages } from './installed';

afterEach(() => {
  resetStores();
  resetSpelling();
});

const start = () => initSettings(defaultBootData(), createWebPlatform());

const pixels = { width: 1, height: 1, format: 'gray8', data: new Uint8Array(1) };
const result = { language: 'en-US', lines: [], angle: null };
const decode = () => Promise.resolve(pixels as never);

describe('text in pictures', () => {
  it('reads in the chosen language, not the Windows profile', async () => {
    start();
    const recognizeImage = vi.fn().mockResolvedValue(result);
    const client = () => Promise.resolve({ recognizeImage } as unknown as IntelClient);
    await readTextInImage(new Blob(), { client, decode });
    expect(recognizeImage).toHaveBeenLastCalledWith(pixels, { language: 'en-US' });
    await setLocale('en-CA');
    await readTextInImage(new Blob(), { client, decode });
    expect(recognizeImage).toHaveBeenLastCalledWith(pixels, { language: 'en-CA' });
  });

  it('falls back to the profile languages when there is no OCR pack for the chosen one', async () => {
    start();
    await setLocale('sv-SE');
    const recognizeImage = vi
      .fn()
      .mockRejectedValueOnce({ code: 'languageUnavailable', message: 'No Swedish pack' })
      .mockResolvedValue(result);
    const client = () => Promise.resolve({ recognizeImage } as unknown as IntelClient);
    await readTextInImage(new Blob(), { client, decode });
    expect(recognizeImage.mock.calls.map((call) => call[1])).toEqual([{ language: 'sv-SE' }, {}]);
  });
});

describe('handwriting', () => {
  it('is read in the chosen language', async () => {
    start();
    await setLocale('en-GB');
    const recognizeInk = vi.fn().mockResolvedValue({ lines: [] });
    const strokes = [{ key: 1, points: [{ x: 0, y: 0 }] }];
    const remove = registerInkStrokeSource({ strokes: () => strokes as never });
    await readHandwriting(['a'], {
      client: () => Promise.resolve({ recognizeInk } as unknown as IntelClient),
      ensureOn: () => Promise.resolve(true),
    });
    remove();
    expect(recognizeInk).toHaveBeenCalledWith(strokes, { kind: 'writing', language: 'en-GB' });
  });
});

describe('spelling', () => {
  it('checks in the chosen language until languages are chosen in Editing settings', async () => {
    start();
    const check = vi.fn().mockResolvedValue([]);
    resetSpelling({
      check,
      languages: () =>
        Promise.resolve([
          { tag: 'en-GB', name: 'English', isDefault: true },
          { tag: 'en-CA', name: 'English', isDefault: false },
        ]),
    } as never);
    await setLocale('en-GB');
    const engine = spellingEngine();
    expect(engine).not.toBeNull();
    engine?.check(['colour'], 'now');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(check).toHaveBeenLastCalledWith(expect.anything(), ['en-GB']);
    await updateSettings({ editing: { spelling: { languages: ['en-CA'] } } });
    engine?.check(['colour two'], 'now');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(check).toHaveBeenLastCalledWith(expect.anything(), ['en-CA']);
  });
});

describe('read aloud', () => {
  const voice = (voiceURI: string, lang: string, isDefault = false) => ({ voiceURI, lang, default: isDefault });
  const voices = [voice('de', 'de-DE', true), voice('gb', 'en-GB'), voice('us', 'en_US'), voice('au', 'en-AU')];

  it('prefers a voice for the chosen dialect, then the language, over the Windows default', () => {
    expect(pickVoice(voices, null, 'en-US')?.voiceURI).toBe('us');
    expect(pickVoice(voices, null, 'en-GB')?.voiceURI).toBe('gb');
    expect(pickVoice(voices, null, 'en-NZ')?.voiceURI).toBe('gb');
    expect(pickVoice(voices, null, 'fr-FR')?.voiceURI).toBe('de');
  });

  it('keeps a voice the person chose', () => {
    expect(pickVoice(voices, 'au', 'en-US')?.voiceURI).toBe('au');
  });
});

describe('hyphenation', () => {
  it('breaks English words by default and leaves another language whole', async () => {
    start();
    expect(syllables('notebook').length).toBeGreaterThan(1);
    await setLocale('de-DE');
    expect(syllables('notebook')).toEqual(['notebook']);
    expect(breakText('notebook')).toBe('notebook');
    await setLocale('en-IN');
    expect(syllables('notebook').length).toBeGreaterThan(1);
  });
});

describe('the other languages in setup', () => {
  it('leave out English, repeats, and empty tags, and sort by name', () => {
    const found = otherLanguages(['de-DE', 'en-GB', 'fr-FR'], ['de-DE', '', 'es-ES']);
    const names = found.map((choice) => choice.name);
    expect(found.map((choice) => choice.tag).sort()).toEqual(['de-DE', 'es-ES', 'fr-FR']);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en-US')));
  });
});
