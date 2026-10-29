import { describe, expect, it } from 'vitest';
import { CALIBRATION_CHARS, PUNCTUATION, SAMPLES_PER_CHAR, SENTENCES, parseSampleId, requiredSamples } from './charset';
import { syntheticProgress, syntheticStyle } from './fixtures';
import { buildStyle, completion, isComplete, measure, measureSentence, slantOf, withSymbols } from './metrics';
import { DOC_VERSION, LIMITS, emptyDoc, parseDoc } from './style';

describe('the calibration page', () => {
  it('asks for every character at least three times, then sentences that use every character', () => {
    expect(SAMPLES_PER_CHAR).toBeGreaterThanOrEqual(3);
    for (const char of [...'aZ09', '…', '€', '£', '°', '•', '“', '—']) expect(CALIBRATION_CHARS).toContain(char);
    const written = new Set([...SENTENCES.join('')]);
    const missing = CALIBRATION_CHARS.filter((c) => !written.has(c));
    expect(missing).toEqual([]);
    expect(PUNCTUATION.length).toBeGreaterThanOrEqual(43);
    expect(requiredSamples()).toHaveLength(CALIBRATION_CHARS.length * SAMPLES_PER_CHAR + SENTENCES.length);
  });

  it('names each sample so it can be read back', () => {
    for (const id of requiredSamples().slice(0, 40)) expect(parseSampleId(id)).not.toBeNull();
    expect(parseSampleId('char:8364:2')).toEqual({ kind: 'char', char: '€', n: 2 });
    expect(parseSampleId('char:99999999:1')).toBeNull();
    expect(parseSampleId('sentence:3')?.kind).toBe('sentence');
  });

  it('tracks how much is done, and makes no style until all of it is', () => {
    const partial = syntheticProgress(undefined, 5);
    expect(isComplete(partial)).toBe(false);
    expect(completion(partial)).toBeGreaterThan(0.95);
    expect(buildStyle(partial, null, 1)).toBeNull();
    expect(isComplete(syntheticProgress())).toBe(true);
  });
});

describe('measuring a hand', () => {
  const hand = { xHeight: 20, slant: 8, seed: 3 };
  const metrics = measure(syntheticProgress(hand));

  it('finds the x-height, cap height, ascenders, and descenders', () => {
    expect(metrics.xHeight).toBeGreaterThan(18.5);
    expect(metrics.xHeight).toBeLessThan(21.5);
    expect(metrics.capHeight).toBeCloseTo(1.45, 1);
    expect(metrics.ascender).toBeGreaterThan(1.4);
    expect(metrics.ascender).toBeLessThan(1.7);
    expect(metrics.descender).toBeGreaterThan(0.4);
    expect(metrics.descender).toBeLessThan(0.75);
  });

  it('finds the slant, and how much size and angle vary', () => {
    expect(metrics.slant.mean).toBeGreaterThan(5);
    expect(metrics.slant.mean).toBeLessThan(11);
    expect(measure(syntheticProgress({ ...hand, slant: -6 })).slant.mean).toBeLessThan(-3);
    expect(metrics.sizeJitter).toBeGreaterThan(0);
    expect(metrics.sizeJitter).toBeLessThan(0.1);
  });

  it('finds letter and word spacing from the sentences, and no joins in a print hand', () => {
    expect(metrics.letterGap.mean).toBeGreaterThan(0.05);
    expect(metrics.letterGap.mean).toBeLessThan(0.4);
    expect(metrics.wordGap.mean).toBeGreaterThan(0.6);
    expect(metrics.wordGap.mean).toBeLessThan(1.3);
    expect(metrics.joinRate).toBeLessThan(0.15);
    expect(metrics.baselineWobble).toBeLessThan(0.2);
  });

  it('finds pressure and speed', () => {
    expect(metrics.pressure.mean).toBeGreaterThan(0.4);
    expect(metrics.pressure.mean).toBeLessThan(0.7);
    expect(metrics.speed).toBeGreaterThan(0.5);
  });

  it('sees a join where one stroke runs across two letters', () => {
    const xh = 20;
    // "no" with one stroke through both letters.
    const stroke: number[] = [];
    for (let i = 0; i <= 40; i++) stroke.push(10 + i * 0.9, 60 - Math.abs(Math.sin(i / 6)) * xh, 0.5, i * 10);
    const found = measureSentence(
      { strokes: [stroke], baseline: 60, guide: xh, width: 200, height: 100, at: 0 },
      'no',
      () => 0.8,
      xh,
    );
    expect(found?.pairs).toEqual([{ pair: 'no', joined: true }]);
  });

  it('reads slant from upright strokes', () => {
    const upright = [0, 0, 0.5, 0, 0, -10, 0.5, 10];
    const leaning = [0, 0, 0.5, 0, 2, -10, 0.5, 10];
    expect(slantOf([upright])).toBeCloseTo(0, 5);
    expect(slantOf([leaning])!).toBeGreaterThan(8);
    expect(slantOf([[0, 0, 0.5, 0, 10, 0, 0.5, 10]])).toBeNull();
  });
});

describe('the style', () => {
  it('holds each character as strokes with pressure and time, in x-height units on the baseline', () => {
    const style = syntheticStyle();
    expect(style.glyphs.a).toHaveLength(3);
    const a = style.glyphs.a[0];
    expect(a.source).toBe('pen');
    expect(a.width).toBeGreaterThan(0.5);
    expect(a.width).toBeLessThan(1.3);
    const ys = a.strokes.flatMap((s) => s.filter((_, i) => i % 4 === 1));
    expect(Math.max(...ys)).toBeCloseTo(0, 0);
    expect(Math.min(...ys)).toBeGreaterThan(-1.3);
    const p = a.strokes[0][2];
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('adds symbols from uploads without ever dropping the pen samples', () => {
    const style = syntheticStyle();
    const symbol = {
      char: '∫',
      strokes: [
        [
          { x: 0, y: 0, p: 0.5, t: 0 },
          { x: 2, y: 30, p: 0.5, t: 100 },
        ],
      ],
      baseline: 20,
      xHeight: 10,
    };
    let next = withSymbols(style, [symbol], 5);
    expect(next.glyphs['∫']).toHaveLength(1);
    expect(next.glyphs['∫'][0].source).toBe('upload');
    for (let i = 0; i < 20; i++) next = withSymbols(next, [{ ...symbol, char: 'a' }], 6 + i);
    expect(next.glyphs.a.length).toBeLessThanOrEqual(LIMITS.variantsPerChar);
    expect(next.glyphs.a.filter((g) => g.source === 'pen')).toHaveLength(3);
    // A rebuilt style keeps what the uploads added.
    const rebuilt = buildStyle(syntheticProgress(), next, 99)!;
    expect(rebuilt.glyphs['∫']).toHaveLength(1);
  });

  it('reads a stored document as untrusted, capping and dropping what does not fit', () => {
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc({ version: 2 })).toBeNull();
    const doc = parseDoc({
      version: DOC_VERSION,
      style: {
        glyphs: {
          a: [{ strokes: [[0, 0, 0.5, 0, 1, 1, 2, 3]], width: 1e9 }, { strokes: 'nope' }],
          ab: [{ strokes: [[0, 0, 0.5, 0]] }],
          b: Array.from({ length: 50 }, () => ({ strokes: [[0, 0, 0.5, 0]], width: 1 })),
          c: [{ strokes: [[0, Number.NaN, 0.5, 0]] }],
        },
        metrics: { xHeight: -5, slant: { mean: 400, sd: 2 }, joins: { ab: 3, abc: 1 } },
      },
      progress: {
        samples: { 'char:97:0': { strokes: [[1, 2, 0.5, 3]], baseline: 5 }, 'evil:1': { strokes: [[1, 2, 3, 4]] } },
      },
      kept: [{ name: 'x.png', data: 'AAAA' }, { name: 3 }],
    })!;
    expect(doc.style!.glyphs.a).toHaveLength(1);
    expect(doc.style!.glyphs.a[0].width).toBe(100);
    expect(doc.style!.glyphs.a[0].strokes[0][6]).toBe(1);
    expect(doc.style!.glyphs.ab).toBeUndefined();
    expect(doc.style!.glyphs.b).toHaveLength(LIMITS.variantsPerChar);
    expect(doc.style!.glyphs.c).toBeUndefined();
    expect(doc.style!.metrics.xHeight).toBe(1);
    expect(doc.style!.metrics.slant.mean).toBe(45);
    expect(doc.style!.metrics.joins).toEqual({ ab: 1 });
    expect(Object.keys(doc.progress.samples)).toEqual(['char:97:0']);
    expect(doc.kept).toHaveLength(1);
    expect(parseDoc(JSON.parse(JSON.stringify(emptyDoc())))).toEqual(emptyDoc());
  });
});
