import { describe, expect, it } from 'vitest';
import type { InkRecognition } from '../../../services/intel';
import {
  alternativesFor,
  chooseReading,
  isUnsure,
  normalizeSymbols,
  reviewLines,
  reviewText,
  subscriptFormulas,
  tidyRecognizedText,
  unsureCount,
} from './extras';

describe('symbols', () => {
  it('keeps the signs people write with the keyboard’s characters', () => {
    expect(normalizeSymbols('x +/- 2, y <= 3, z >= 4, a != b')).toBe('x ± 2, y ≤ 3, z ≥ 4, a ≠ b');
    expect(normalizeSymbols('A -> B, B <- A, A <-> B, A => B')).toBe('A → B, B ← A, A ↔ B, A ⇒ B');
    expect(normalizeSymbols('pi ~= 3.14')).toBe('pi ≈ 3.14');
  });

  it('writes degrees after a number', () => {
    expect(normalizeSymbols('25 oC and 90 deg and 98.6 oF')).toBe('25°C and 90° and 98.6°F');
  });

  it('writes the micro prefix after a number only', () => {
    expect(normalizeSymbols('5 uM, 2 ug, 3 umol')).toBe('5 µM, 2 µg, 3 µmol');
    expect(normalizeSymbols('the umbrella')).toBe('the umbrella');
  });

  it('writes powers', () => {
    expect(normalizeSymbols('m^2 and 10^-3')).toBe('m² and 10⁻³');
  });
});

describe('chemistry', () => {
  it('gives formulas their subscripts', () => {
    expect(subscriptFormulas('H2O and CO2 and C6H12O6')).toBe('H₂O and CO₂ and C₆H₁₂O₆');
    expect(subscriptFormulas('Ca(OH)2')).toBe('Ca(OH)₂');
    expect(subscriptFormulas('O2 is a gas')).toBe('O₂ is a gas');
  });

  it('writes a charge as a superscript', () => {
    expect(tidyRecognizedText('SO4^2- in water')).toBe('SO₄²⁻ in water');
  });

  it('leaves words and codes that only look like formulas', () => {
    expect(subscriptFormulas('The Page A4 and B2 and Room4 and NaCl')).toBe('The Page A4 and B2 and Room4 and NaCl');
  });
});

describe('unsure words', () => {
  it('is unsure when two other readings differ by more than case', () => {
    expect(isUnsure({ text: 'cat', alternates: ['Cat', 'cot', 'cut'] })).toBe(true);
    expect(isUnsure({ text: 'cat', alternates: ['Cat', 'cat.', 'cot'] })).toBe(false);
    expect(isUnsure({ text: 'cat', alternates: [] })).toBe(false);
  });

  it('offers each other reading once', () => {
    expect(alternativesFor({ text: 'cat', alternates: ['cat', 'cot', 'cot', 'cut', ' '] })).toEqual(['cot', 'cut']);
  });
});

const rect = { x: 0, y: 0, width: 1, height: 1 };
const recognition: InkRecognition = {
  lines: [
    {
      text: 'Add H2O -> beaker',
      bounds: rect,
      words: [
        { text: 'Add', alternates: [], strokes: [], bounds: rect },
        { text: 'H2O', alternates: [], strokes: [], bounds: rect },
        { text: '->', alternates: [], strokes: [], bounds: rect },
        { text: 'beaker', alternates: ['beater', 'beaver'], strokes: [], bounds: rect },
      ],
    },
    { text: 'no words', bounds: rect, words: [] },
  ],
};

describe('the review', () => {
  it('turns the recognition into words and counts the unsure ones', () => {
    const lines = reviewLines(recognition);
    expect(lines).toHaveLength(2);
    expect(unsureCount(lines)).toBe(1);
    expect(lines[0]?.[3]).toEqual({ text: 'beaker', alternatives: ['beater', 'beaver'], unsure: true });
  });

  it('tidies the text it gives back', () => {
    expect(reviewText(reviewLines(recognition))).toEqual(['Add H₂O → beaker', 'no words']);
  });

  it('replaces a word with the reading the person chose', () => {
    const chosen = chooseReading(reviewLines(recognition), { line: 0, word: 3 }, 'beater');
    expect(reviewText(chosen)[0]).toBe('Add H₂O → beater');
    expect(unsureCount(chosen)).toBe(0);
    expect(chosen[0]?.[3]?.alternatives).toEqual(['beaker', 'beaver']);
  });
});
