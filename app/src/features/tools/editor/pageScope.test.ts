// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { joinScope, linesBefore, refreshOthers } from './pageScope';
import { evaluateNotes } from '../calculator';

function page() {
  const root = document.createElement('div');
  const make = (text: string[]) => {
    const element = document.createElement('div');
    root.append(element);
    let refreshed = 0;
    const box = { element, lines: () => text, refresh: () => void refreshed++ };
    joinScope(root, box);
    return { box, count: () => refreshed };
  };
  return { root, make };
}

describe('page scope', () => {
  it('lends earlier boxes lines to later ones, in page order', () => {
    const { root, make } = page();
    const a = make(['rent = 1,200']);
    const b = make(['tax = 5']);
    const c = make(['rent * 12 =']);
    expect(linesBefore(root, c.box)).toEqual(['rent = 1,200', 'tax = 5']);
    expect(linesBefore(root, a.box)).toEqual([]);
    expect(linesBefore(root, b.box)).toEqual(['rent = 1,200']);
  });
  it('keeps pages apart and forgets a box that leaves', () => {
    const one = page();
    const two = page();
    const a = one.make(['x = 1']);
    const b = two.make(['x = 2']);
    expect(linesBefore(two.root, b.box)).toEqual([]);
    const leave = joinScope(one.root, { ...a.box, element: document.createElement('div') });
    leave();
  });
  it('asks the others to redraw', () => {
    const { root, make } = page();
    const a = make(['a = 1']);
    const b = make(['a ='] );
    refreshOthers(root, a.box);
    expect(b.count()).toBe(1);
    expect(a.count()).toBe(0);
  });
  it('gives the later box its answer from the earlier definition', () => {
    const lines = ['rent = 1,200', 'rent * 12 ='];
    const out = evaluateNotes(lines);
    expect(out[1]?.kind).toBe('result');
  });
});

describe('recognized handwriting', () => {
  it('evaluates what the recognizer writes, with the page variables before it', () => {
    const out = evaluateNotes(['rent = 1,200', '3 × rent =', '12 ÷ 4 −1 =']);
    expect(out[1]?.kind).toBe('result');
    expect(out[2]?.kind).toBe('result');
  });
});
