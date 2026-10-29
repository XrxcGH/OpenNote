// Translation over the shell's language packs (A3-25): the packs come from the model catalog, a download reports its
// progress, and the translation runs only with a pack that is on the computer. The shell is the fake one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeIntelTransport, createIntelExt } from '../../services/intel';
import { translateMarkdown } from './engine';
import { canTranslate, createLocalTranslationEngine, packOf, POLL_MS } from './localEngine';

function setup() {
  const transport = createFakeIntelTransport();
  const ext = createIntelExt(transport);
  return { transport, ext, engine: createLocalTranslationEngine(() => Promise.resolve(ext)) };
}

afterEach(() => vi.useRealTimers());

describe('the language packs', () => {
  it('lists the translation packs of the catalog with their sizes, and none as downloaded', async () => {
    const { engine } = setup();
    const packs = await engine.packs();
    const spanish = packs.find((pack) => pack.id === 'en-es');
    expect(spanish).toMatchObject({ from: 'en', to: 'es', name: 'English to Spanish', size: 119_006_287 });
    expect(packs.length).toBeGreaterThanOrEqual(20);
    expect((await engine.installed()).size).toBe(0);
  });

  it('reads a pack from a catalog entry and ignores other models', () => {
    expect(packOf({ id: 'translate-fr-en', kind: 'translate', name: 'x', detail: '', sizeBytes: 9 } as never)).toEqual({
      id: 'fr-en',
      from: 'fr',
      to: 'en',
      name: 'x',
      size: 9,
    });
    expect(packOf({ id: 'speech-base', kind: 'speech' } as never)).toBeNull();
    expect(packOf({ id: 'translate-xx', kind: 'translate' } as never)).toBeNull();
  });

  it('says whether this build can translate', async () => {
    const { ext } = setup();
    expect(await canTranslate(() => Promise.resolve(ext))).toBe(true);
    expect(await canTranslate(() => Promise.reject(new Error('no shell')))).toBe(false);
  });
});

describe('downloading and translating', () => {
  it('reports progress while a pack downloads and resolves when it is on the computer', async () => {
    vi.useFakeTimers();
    const { transport, engine } = setup();
    const pack = (await engine.packs()).find((one) => one.id === 'en-es');
    if (!pack) throw new Error('no pack');
    const seen: number[] = [];
    const done = engine.install(pack, (fraction) => seen.push(fraction));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    transport.ext.tick(pack.size / 2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    transport.ext.tick(pack.size);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await done;
    expect(seen.at(-1)).toBe(1);
    expect(seen.some((one) => one > 0 && one < 1)).toBe(true);
    expect((await engine.installed()).has('en-es')).toBe(true);
  });

  it('refuses to translate with a pack that is not downloaded', async () => {
    const { engine } = setup();
    await expect(engine.translate(['hello'], 'en', 'es')).rejects.toThrow(/not downloaded/);
  });

  it('translates through the shell once the pack is there, keeping the formatting of the page', async () => {
    vi.useFakeTimers();
    const { transport, engine, ext } = setup();
    const pack = (await engine.packs()).find((one) => one.id === 'en-es');
    if (!pack) throw new Error('no pack');
    const done = engine.install(pack);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    transport.ext.tick(pack.size);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await done;
    expect(await engine.translate(['Hello'], 'en', 'es')).toEqual(['[es] Hello']);
    // With the source language unknown, any installed pack into the language serves.
    expect(await engine.translate(['Hello'], null, 'es')).toEqual(['[es] Hello']);
    const result = await translateMarkdown('# Plan\n\nSee **the notes** and `code()`.', engine, 'en', 'es');
    expect(result.text).toContain('# [es] Plan');
    expect(result.text).toContain('`code()`');
    await engine.remove(pack);
    expect((await ext.models.list()).models.find((one) => one.id === 'translate-en-es')?.state).toBe('notInstalled');
  });
});
