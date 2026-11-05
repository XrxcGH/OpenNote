// Read aloud in the real app, nightly (Phase 4 PLAN.md section 11; spike S2): WebView2 lists local voices, Ctrl+Shift+U
// starts reading, the spoken word is highlighted from boundary events, and pause holds the highlight still. Runners
// without a local voice skip.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason, removeFolder } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';
import { flaggedProfile, openMitosisText } from './helpers.ts';

const spoken = (browser: Browser) =>
  browser.execute(() => [...(CSS.highlights.get('read-aloud') ?? [])].map((range) => range.toString()).join(''));

describe('read aloud', { skip: skipReason() }, () => {
  const profileDir = flaggedProfile('opennote-e2e-read-aloud-', { 'editor.readAloud': true });
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    removeFolder(profileDir);
  });

  it('reads with a local voice and highlights each word', async (context) => {
    session = await launchApp({ profileDir });
    const { browser } = session;
    // The web speech engine itself must be able to speak here. A runner with voices and no audio output lists the
    // voices and then fails every utterance (audio-hardware), which the app rightly reports as no voice.
    const speech = await browser.executeAsync((done: (result: { local: number; error: string | null }) => void) => {
      const voices = () => speechSynthesis.getVoices().filter((voice) => voice.localService);
      const speak = () => {
        const first = voices()[0];
        if (!first) return done({ local: 0, error: null });
        const utterance = new SpeechSynthesisUtterance('Test.');
        utterance.voice = first;
        utterance.onstart = () => {
          speechSynthesis.cancel();
          done({ local: voices().length, error: null });
        };
        utterance.onerror = (event) => done({ local: voices().length, error: event.error });
        speechSynthesis.speak(utterance);
      };
      if (voices().length) speak();
      else speechSynthesis.addEventListener('voiceschanged', speak, { once: true });
      setTimeout(() => done({ local: voices().length, error: 'no start within 8 seconds' }), 8_000);
    });
    if (!speech.local) {
      context.skip('No local voices on this runner.');
      return;
    }
    if (speech.error) {
      context.skip(`This runner's voices cannot speak (${speech.error}).`);
      return;
    }
    await openMitosisText(browser);
    // The sample page starts empty, so there is something to read first.
    await browser.keys([...'Cells divide in two. Each new cell is the same as the first.']);
    await browser.keys(['Control', 'Home']);
    await browser.keys(['Control', 'Shift', 'u']);
    await browser.$('[role="region"][aria-label="Read aloud"]').waitForExist({ timeout: 5_000 });
    await browser.waitUntil(async () => (await spoken(browser)).length > 0, { timeout: 10_000 });
    await browser.keys(['Control', 'Shift', 'u']);
    const paused = await spoken(browser);
    await browser.pause(1_000);
    assert.equal(await spoken(browser), paused, 'the highlight holds while paused');
    await browser.keys(['Control', 'Shift', 'u']);
    await browser.waitUntil(async () => (await spoken(browser)) !== paused, { timeout: 10_000 });
  });
});
