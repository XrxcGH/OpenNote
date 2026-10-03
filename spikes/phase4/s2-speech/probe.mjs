// Spike S2 (Phase 4 PLAN.md section 11; ADR 0023): does Chromium's Web Speech on Windows, the engine WebView2 uses,
// list local voices, report word boundaries, and pause and resume? Runs the installed Edge through Playwright and
// writes spikes/results/s2-speech.json. Usage: node spikes/phase4/s2-speech/probe.mjs [--headed]
/* global speechSynthesis, SpeechSynthesisUtterance, performance, setTimeout, process, URL, console */
import { writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { chromium } from 'playwright';

const TEXT = 'The quick brown fox jumps over the lazy dog, then rests in the warm afternoon sun.';

async function probe(page) {
  return page.evaluate(async (text) => {
    const voices = await new Promise((resolve) => {
      const list = () => speechSynthesis.getVoices();
      if (list().length) return resolve(list());
      speechSynthesis.addEventListener('voiceschanged', () => resolve(list()), { once: true });
      setTimeout(() => resolve(list()), 3000);
    });
    const local = voices.filter((voice) => voice.localService);
    const result = {
      voices: voices.length,
      local: local.map((voice) => ({ name: voice.name, lang: voice.lang, default: voice.default })),
      online: voices.filter((voice) => !voice.localService).length,
      boundaries: [],
      paused: null,
      resumed: null,
      ended: false,
      error: null,
    };
    const voice = local.find((item) => item.lang.startsWith('en')) ?? local[0];
    if (!voice) return result;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    const started = performance.now();
    await new Promise((resolve) => {
      utterance.onboundary = (event) =>
        result.boundaries.push({
          name: event.name,
          charIndex: event.charIndex,
          charLength: event.charLength,
          ms: Math.round(performance.now() - started),
        });
      utterance.onend = () => {
        result.ended = true;
        resolve();
      };
      utterance.onerror = (event) => {
        result.error = event.error;
        resolve();
      };
      speechSynthesis.speak(utterance);
      setTimeout(() => {
        const before = result.boundaries.length;
        speechSynthesis.pause();
        setTimeout(() => {
          result.paused = {
            speaking: speechSynthesis.speaking,
            paused: speechSynthesis.paused,
            boundariesDuringPause: result.boundaries.length - before,
          };
          speechSynthesis.resume();
          setTimeout(() => {
            result.resumed = { paused: speechSynthesis.paused, boundariesAfter: result.boundaries.length - before };
          }, 1500);
        }, 1500);
      }, 1500);
      setTimeout(resolve, 20000);
    });
    return result;
  }, TEXT);
}

const browser = await chromium.launch({ channel: 'msedge', headless: !process.argv.includes('--headed') });
const page = await browser.newPage();
await page.goto('about:blank');
const result = await probe(page);
const version = browser.version();
await browser.close();
const out = {
  spike: 's2-speech',
  at: new Date().toISOString(),
  os: `Windows ${release()}`,
  browser: version,
  text: TEXT,
};
Object.assign(out, result);
writeFileSync(new URL('../../results/s2-speech.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
const words = out.boundaries.filter((boundary) => boundary.name === 'word').length;
const summary = { voices: out.voices, local: out.local.length, online: out.online, words };
console.log(
  JSON.stringify({ ...summary, paused: out.paused, resumed: out.resumed, ended: out.ended, error: out.error }),
);
