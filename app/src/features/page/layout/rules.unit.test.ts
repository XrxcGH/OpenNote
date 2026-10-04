// The snapping math for ruled paper: which rule a text box snaps to, how a nudge steps, how tall a block is padded to
// be, and how far the flow's first line is from a rule.
import { describe, expect, it } from 'vitest';
import { leadFor, ruleProperties, snapY, stepY, wholeRules } from './rules';
import type { RuleGrid } from './rules';

const GRID: RuleGrid = { step: 20, origin: 50, sheet: null };
const SHEETS: RuleGrid = { step: 20, origin: 50, sheet: 1000 };

describe('snapY', () => {
  it('moves to the nearest rule', () => {
    expect(snapY(50, GRID)).toBe(50);
    expect(snapY(59, GRID)).toBe(50);
    expect(snapY(61, GRID)).toBe(70);
    expect(snapY(0, GRID)).toBe(10);
  });

  it('never goes above the first rule of the page or of a sheet', () => {
    expect(snapY(-5, GRID)).toBe(10);
    expect(snapY(0, SHEETS)).toBe(10);
    expect(snapY(1000, SHEETS)).toBe(1010);
    expect(stepY(10, -1, GRID)).toBe(10);
  });

  it('rounds a tie up, as CSS round(nearest) does', () => {
    expect(snapY(60, GRID)).toBe(70);
  });

  it('leaves plain paper alone', () => {
    expect(snapY(123.7, null)).toBe(123.7);
  });

  it('starts the lattice again on every sheet', () => {
    expect(snapY(1061, SHEETS)).toBe(1070);
    expect(snapY(2049, SHEETS)).toBe(2050);
    expect(snapY(1990, SHEETS)).toBe(1990);
  });
});

describe('stepY', () => {
  it('moves a box one rule at a time', () => {
    expect(stepY(70, 1, GRID)).toBe(90);
    expect(stepY(70, -1, GRID)).toBe(50);
  });

  it('goes to the next rule in its direction from between two rules', () => {
    expect(stepY(65, 1, GRID)).toBe(70);
    expect(stepY(65, -1, GRID)).toBe(50);
  });

  it('moves one unit on plain paper', () => {
    expect(stepY(10, 1, null)).toBe(11);
  });
});

describe('wholeRules', () => {
  it('rounds a height up to whole rules, at least one', () => {
    expect(wholeRules(0, GRID)).toBe(20);
    expect(wholeRules(20, GRID)).toBe(20);
    expect(wholeRules(20.3, GRID)).toBe(20);
    expect(wholeRules(21, GRID)).toBe(40);
    expect(wholeRules(81, GRID)).toBe(100);
  });

  it('leaves plain paper alone', () => {
    expect(wholeRules(33, null)).toBe(33);
  });
});

describe('leadFor', () => {
  it('is how far down the next rule is', () => {
    expect(leadFor(50, GRID)).toBe(0);
    expect(leadFor(45, GRID)).toBe(5);
    expect(leadFor(51, GRID)).toBe(19);
    expect(leadFor(130, GRID)).toBe(0);
  });

  it('counts from the top margin of the sheet the flow starts on', () => {
    expect(leadFor(1045, SHEETS)).toBe(5);
  });
});

describe('ruleProperties', () => {
  it('names the spacing, the origin, and the sheet height for the stylesheet', () => {
    expect(ruleProperties(SHEETS, { text: 0.7, mono: 0.6 })).toMatchObject({
      '--rule': '20px',
      '--rule-origin': '50px',
      '--rule-sheet': '1000px',
    });
    expect(ruleProperties(GRID, { text: 0.7, mono: 0.6 })['--rule-sheet']).toBe('1000000000px');
  });
});
