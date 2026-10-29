// The symbol table, its LaTeX-style completion, its search, and the recent list.
import { beforeEach, describe, expect, it } from 'vitest';
import { SYMBOLS, SYMBOL_GROUPS, completions, searchSymbols, symbolFor } from './data';
import { RECENT_LIMIT, pushRecent, readRecent, resetRecent } from './recent';

describe('the symbol table', () => {
  it('has no character twice and no command name twice', () => {
    const chars = SYMBOLS.map((symbol) => symbol.char);
    expect(new Set(chars).size).toBe(chars.length);
    const names = SYMBOLS.flatMap((symbol) => symbol.commands);
    expect(new Set(names).size).toBe(names.length);
  });
  it('fills every group', () => {
    for (const group of SYMBOL_GROUPS) expect(SYMBOLS.some((symbol) => symbol.group === group)).toBe(true);
  });
  it('types the LaTeX names students know', () => {
    const known: Record<string, string> = {
      alpha: 'α',
      beta: 'β',
      gamma: 'γ',
      Gamma: 'Γ',
      Delta: 'Δ',
      theta: 'θ',
      lambda: 'λ',
      mu: 'μ',
      pi: 'π',
      sigma: 'σ',
      Sigma: 'Σ',
      omega: 'ω',
      Omega: 'Ω',
      ohm: 'Ω',
      infty: '∞',
      partial: '∂',
      nabla: '∇',
      int: '∫',
      sum: '∑',
      leq: '≤',
      geq: '≥',
      neq: '≠',
      approx: '≈',
      pm: '±',
      times: '×',
      cdot: '·',
      rightarrow: '→',
      Rightarrow: '⇒',
      forall: '∀',
      exists: '∃',
      in: '∈',
      cup: '∪',
      cap: '∩',
      degree: '°',
      sqrt: '√',
      hbar: 'ℏ',
    };
    for (const [name, char] of Object.entries(known)) expect(symbolFor(name)?.char, name).toBe(char);
  });
  it('is case-sensitive, so Gamma and gamma differ', () => {
    expect(symbolFor('gamma')?.char).not.toBe(symbolFor('Gamma')?.char);
    expect(symbolFor('nonsense')).toBeUndefined();
  });
});

describe('completion', () => {
  it('lists names that start with what was typed, the exact name first', () => {
    expect(completions('alp')[0]?.command).toBe('alpha');
    const found = completions('int').map((one) => one.command);
    expect(found[0]).toBe('int');
    expect(found).toContain('integral');
  });
  it('puts the name that matches the typed case before the other case', () => {
    expect(completions('G')[0]?.command).toBe('Gamma');
    expect(completions('gam')[0]?.command).toBe('gamma');
    expect(completions('gam').map((one) => one.command)).toContain('Gamma');
  });
  it('offers nothing for an empty or unknown start, and honors the limit', () => {
    expect(completions('')).toEqual([]);
    expect(completions('qqq')).toEqual([]);
    expect(completions('s', 3)).toHaveLength(3);
  });
});

describe('search', () => {
  it('finds a symbol by its character, LaTeX name, or a word of its name', () => {
    expect(searchSymbols('π').map((one) => one.char)).toContain('π');
    expect(searchSymbols('\\alpha')[0]?.char).toBe('α');
    expect(searchSymbols('less than').map((one) => one.char)).toEqual(expect.arrayContaining(['≤', '≪']));
    expect(searchSymbols('ohm')[0]?.char).toBe('Ω');
  });
  it('limits a search to one group and returns all of it for an empty search', () => {
    expect(searchSymbols('', 'arrows').every((one) => one.group === 'arrows')).toBe(true);
    expect(searchSymbols('')).toHaveLength(SYMBOLS.length);
    expect(searchSymbols('alpha', 'arrows')).toEqual([]);
  });
});

describe('recent symbols', () => {
  beforeEach(() => resetRecent());
  it('keeps the newest first without repeats, up to the limit', () => {
    pushRecent('α');
    pushRecent('β');
    expect(pushRecent('α')).toEqual(['α', 'β']);
    for (let i = 0; i < RECENT_LIMIT + 5; i += 1) pushRecent(`s${i}`);
    expect(readRecent()).toHaveLength(RECENT_LIMIT);
  });
  it('clears', () => {
    pushRecent('π');
    resetRecent();
    expect(readRecent()).toEqual([]);
  });
});
