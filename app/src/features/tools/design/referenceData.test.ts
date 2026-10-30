import { describe, expect, it } from 'vitest';
import { ALL_CARDS, PRECEDENCE, groupsFirst, rankOf, searchCards, traceTable, traceVariables } from './referenceData';

describe('operator precedence', () => {
  it('multiplicative above additive', () => {
    expect(groupsFirst('*', '+')).toBe('first');
    expect(groupsFirst('/', '-')).toBe('first');
    expect(groupsFirst('%', '+')).toBe('first');
    expect(groupsFirst('+', '*')).toBe('second');
  });
  it('relational above equality', () => {
    expect(rankOf('<')).toBeLessThan(rankOf('==')!);
    expect(groupsFirst('<', '==')).toBe('first');
  });
  it('&& above ||', () => {
    expect(groupsFirst('&&', '||')).toBe('first');
    expect(rankOf('||')).toBeLessThan(rankOf('=')!);
  });
  it('assignment is lowest except the comma, and groups right to left', () => {
    const ranks = PRECEDENCE.map((r) => r.rank);
    expect(Math.max(...ranks)).toBe(rankOf(','));
    expect(rankOf('=')).toBe(Math.max(...ranks) - 1);
    expect(groupsFirst('=', '+=')).toBe('right-to-left');
    expect(groupsFirst('+', '-')).toBe('left-to-right');
  });
  it('bitwise operators sit between equality and logical and, and and binds tighter than xor than or', () => {
    expect(rankOf('==')!).toBeLessThan(rankOf('&')!);
    expect(rankOf('&')!).toBeLessThan(rankOf('^')!);
    expect(rankOf('^')!).toBeLessThan(rankOf('|')!);
    expect(rankOf('|')!).toBeLessThan(rankOf('&&')!);
  });
  it('unknown operators and unique operators', () => {
    expect(rankOf('@@')).toBeNull();
    expect(groupsFirst('@@', '+')).toBeNull();
    const all = PRECEDENCE.flatMap((r) => r.ops);
    expect(new Set(all).size).toBe(all.length);
    expect(PRECEDENCE.map((r) => r.rank)).toEqual([...PRECEDENCE.keys()].map((i) => i + 1));
  });
});

describe('cards and search', () => {
  it('has unique ids and non-empty text', () => {
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ALL_CARDS) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.body.length).toBeGreaterThan(20);
    }
  });
  it('finds cards, titles first, and needs every word', () => {
    const r = searchCards(ALL_CARDS, 'segmentation');
    expect(r[0]?.id).toBe('err-segv');
    expect(searchCards(ALL_CARDS, 'polyfit').map((c) => c.id)).toContain('m-poly');
    expect(searchCards(ALL_CARDS, 'polyfit zzzz')).toEqual([]);
    expect(searchCards(ALL_CARDS, '   ')).toHaveLength(ALL_CARDS.length);
    expect(searchCards(ALL_CARDS, 'LONG LONG').map((c) => c.id)).toContain('type-short-int');
  });
});

describe('trace tables', () => {
  it('has columns line, i, sum, output', () => {
    const vars = traceVariables('i, sum');
    expect(vars).toEqual(['i', 'sum']);
    const t = traceTable(vars, 4, { line: 'line', output: 'output' });
    expect(t.header).toEqual(['line', 'i', 'sum', 'output']);
    expect(t.rows).toHaveLength(4);
    expect(t.rows.every((r) => r.length === 4)).toBe(true);
  });
  it('cleans the variable list and limits the size', () => {
    expect(traceVariables('x x 2bad y_1;z')).toEqual(['x', 'y_1', 'z']);
    expect(traceVariables('')).toEqual([]);
    expect(traceVariables(Array.from({ length: 30 }, (_, i) => `v${i}`).join(' '))).toHaveLength(12);
    expect(traceTable([], 0, { line: 'l', output: 'o' }).rows).toHaveLength(1);
    expect(traceTable([], 999, { line: 'l', output: 'o' }).rows).toHaveLength(60);
  });
});
