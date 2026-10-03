// Read aloud in the browser: local voices only, the sequence, the word highlight following boundary events, the
// bar, and stopping. The engine is a fake that reports boundaries when the test says so.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../test';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { resetReadAloud, startReading, toggleReadAloud } from './chunk';
import { createWebSpeechEngine } from './engine';
import type { SpeechEngine } from './engine';
import { READ_HIGHLIGHT } from './reader';

function fakeEngine() {
  const spoken: string[] = [];
  let onBoundary: (start: number, length: number) => void = () => undefined;
  let onEnd: (completed: boolean) => void = () => undefined;
  const engine: SpeechEngine = {
    voices: () => Promise.resolve([{ id: 'local', name: 'Local voice', language: 'en-US', isDefault: true }]),
    speak(text, _options, boundary, end) {
      spoken.push(text);
      onBoundary = boundary;
      onEnd = end;
    },
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  };
  return { engine, spoken, word: (start: number, length: number) => onBoundary(start, length), end: () => onEnd(true) };
}

const highlighted = () => [...(CSS.highlights.get(READ_HIGHLIGHT) ?? [])].map((range) => range.toString());

afterEach(async () => {
  resetReadAloud();
  await cleanupPages();
});

describe('the Web Speech engine', () => {
  // A real utterance takes only the browser's own voice objects.
  beforeEach(() => {
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        voice: SpeechSynthesisVoice | null = null;
        lang = '';
        rate = 1;
        constructor(readonly text: string) {}
      },
    );
  });
  afterEach(() => void vi.unstubAllGlobals());

  it('lists and speaks with local voices only', async () => {
    const voice = (name: string, localService: boolean, isDefault = false) =>
      ({ name, voiceURI: name, lang: 'en-US', localService, default: isDefault }) as SpeechSynthesisVoice;
    const speak = vi.fn();
    const synth = {
      getVoices: () => [voice('Online', false, true), voice('Local', true)],
      speak,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as SpeechSynthesis;
    const engine = createWebSpeechEngine(synth)!;
    expect((await engine.voices()).map((v) => v.name)).toEqual(['Local']);
    engine.speak(
      'Hello',
      { voice: 'Online', rate: 1.5 },
      () => undefined,
      () => undefined,
    );
    const utterance = speak.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.voice?.name).toBe('Local');
    expect(utterance.rate).toBe(1.5);
  });

  it('never falls back to an online voice', () => {
    const speak = vi.fn();
    const online = { name: 'Online', voiceURI: 'Online', lang: 'en-US', localService: false, default: true };
    const synth = { getVoices: () => [online], speak, cancel: vi.fn() } as unknown as SpeechSynthesis;
    const end = vi.fn();
    createWebSpeechEngine(synth)!.speak('Hello', { voice: null, rate: 1 }, () => undefined, end);
    expect(speak).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledWith(false);
  });
});

describe('read aloud', () => {
  it('reads paragraphs in order, highlights each spoken word, and passes axe', async () => {
    const fake = fakeEngine();
    resetReadAloud(fake.engine);
    await renderPage({
      fixture: textPageFixture('First light.\n\n```\nlet a = 1;\n```\n\nSecond part.'),
      flags: { 'editor.readAloud': true },
    });
    startReading();
    expect(fake.spoken).toEqual(['First light.']);
    fake.word(6, 5);
    expect(highlighted()).toEqual(['light']);
    fake.end();
    expect(fake.spoken.at(-1)).toBe('Code block, 1 line');
    fake.end();
    expect(fake.spoken.at(-1)).toBe('Second part.');
    fake.word(0, 6);
    expect(highlighted()).toEqual(['Second']);
    const bar = await screen.findByRole('region', { name: 'Read aloud' });
    await expectNoAxeViolations(bar);
    fake.end();
    expect(highlighted()).toEqual([]);
  });

  it('pauses and resumes with the toggle, moves by paragraph, and stops on Escape', async () => {
    const fake = fakeEngine();
    resetReadAloud(fake.engine);
    await renderPage({ fixture: textPageFixture('One.\n\nTwo.\n\nThree.'), flags: { 'editor.readAloud': true } });
    toggleReadAloud();
    toggleReadAloud();
    expect(fake.engine.pause).toHaveBeenCalled();
    toggleReadAloud();
    expect(fake.engine.resume).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Next paragraph' }));
    expect(fake.spoken.at(-1)).toBe('Two.');
    await userEvent.click(screen.getByRole('button', { name: 'Previous paragraph' }));
    expect(fake.spoken.at(-1)).toBe('One.');
    screen.getByRole('button', { name: 'Pause' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Read aloud' })).toBeNull();
  });

  it('reads from the caret to the end', async () => {
    const fake = fakeEngine();
    resetReadAloud(fake.engine);
    const page = await renderPage({
      fixture: textPageFixture('Skip this.\n\nStart here please.\n\nThen this.'),
      flags: { 'editor.readAloud': true },
    });
    const editor = page.mounted.pool.mount('01k6f0000000000000000t0001', { kind: 'start' }, 'target')!;
    const at = editor.state.doc.content.size;
    let caret = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.startsWith('Start')) caret = pos + 'Start '.length;
    });
    expect(caret).toBeGreaterThan(0);
    expect(caret).toBeLessThan(at);
    editor.commands.setTextSelection(caret + 2);
    editor.view.focus();
    startReading();
    expect(fake.spoken[0]).toBe('here please.');
    fake.end();
    expect(fake.spoken[1]).toBe('Then this.');
  });
});
