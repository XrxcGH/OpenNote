// The study core: blanks, the schedule, exam targets, inline cards, generation, and text import and export.
import { describe, expect, it } from 'vitest';
import { blanksOf, fromAnkiCloze, hideBlanks, showBlanks } from './cloze';
import { addDays, dayKey, daysBetween, isDayKey } from './dates';
import { cardsFromRows, cardsFromText, deckToCsv, parseCards, parseDelimited, planImport } from './exchange';
import { generateCards } from './generate';
import { cardOfLine, inlineCards } from './inline';
import { capToExam, counts, dailyTarget, nextState, todaysQueue } from './schedule';
import type { Card, Deck, States } from './types';

const card = (id: string, front = id, back = 'answer'): Card => ({ id, kind: 'basic', front, back });

describe('days', () => {
  it('count whole days across month ends', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
    expect(dayKey(new Date(2026, 4, 9))).toBe('2026-05-09');
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-02-28')).toBe(true);
  });
});

describe('blanks', () => {
  it('hide, show, and read Anki clozes', () => {
    expect(blanksOf('The {{mitochondria}} makes {{ATP}}')).toEqual(['mitochondria', 'ATP']);
    expect(hideBlanks('A {{b}} c')).toBe('A [...] c');
    expect(showBlanks('A {{b}} c')).toBe('A b c');
    expect(fromAnkiCloze('{{c1::Paris::city}} is in {{c2::France}}')).toBe('{{Paris}} is in {{France}}');
  });
});

describe('the schedule', () => {
  const today = '2026-06-01';
  it('spaces good answers further apart', () => {
    const one = nextState(undefined, 'good', today);
    expect(one.due).toBe('2026-06-02');
    const two = nextState(one, 'good', '2026-06-02');
    expect(two.interval).toBe(3);
    const three = nextState(two, 'good', two.due);
    expect(three.interval).toBeGreaterThan(6);
  });
  it('brings a missed card back the same day and lowers its ease', () => {
    const state = nextState(nextState(undefined, 'good', today), 'again', today);
    expect(state.due).toBe(today);
    expect(state.lapses).toBe(1);
    expect(state.ease).toBeLessThan(2.5);
  });
  it('pulls a due day in before the exam', () => {
    const state = nextState(undefined, 'easy', today);
    expect(capToExam({ ...state, due: '2026-06-20' }, '2026-06-10', today).due).toBe('2026-06-09');
    expect(capToExam({ ...state, due: '2026-06-05' }, '2026-06-10', today).due).toBe('2026-06-05');
  });
  it('queues due cards before new ones and limits new cards', () => {
    const cards = Array.from({ length: 14 }, (_, i) => card(`c${i}`));
    const deck: Deck = { id: 'd', name: 'Deck', cards };
    const states: States = { c0: nextState(undefined, 'again', today) };
    const queue = todaysQueue(deck, states, today);
    expect(queue[0].id).toBe('c0');
    expect(queue).toHaveLength(1 + 9);
    expect(counts(deck, states, today)).toEqual({ due: 1, fresh: 9 });
  });
});

describe('exam dates', () => {
  it('spread the cards that are left over the days that are left', () => {
    const deck: Deck = {
      id: 'd',
      name: 'Deck',
      exam: '2026-06-11',
      cards: Array.from({ length: 25 }, (_, i) => card(`c${i}`)),
    };
    expect(dailyTarget(deck, {}, '2026-06-01')).toEqual({ perDay: 3, daysLeft: 10, remaining: 25 });
    expect(todaysQueue(deck, {}, '2026-06-01')).toHaveLength(3);
  });
  it('show nothing once the exam has passed', () => {
    expect(dailyTarget({ id: 'd', name: 'D', exam: '2026-05-01', cards: [card('a')] }, {}, '2026-06-01')).toBeNull();
  });
});

describe('inline cards', () => {
  it('read Q :: A lines and lines with blanks, through list markers', () => {
    expect(cardOfLine('- Capital of France :: Paris')).toEqual({
      kind: 'basic',
      front: 'Capital of France',
      back: 'Paris',
    });
    expect(cardOfLine('1. [ ] Water is {{H2O}}')).toEqual({ kind: 'cloze', front: 'Water is {{H2O}}', back: '' });
    expect(cardOfLine('just text')).toBeNull();
    expect(cardOfLine(' :: nothing')).toBeNull();
  });
  it('are named by block and line so editing a line keeps the card', () => {
    const cards = inlineCards([{ id: 'b1', markdown: 'intro\nA :: B\nC :: D' }]);
    expect(cards.map((one) => one.id)).toEqual(['inline:b1:1', 'inline:b1:2']);
  });
});

describe('generated cards', () => {
  const text = [
    '## Photosynthesis',
    'Plants turn light, water, and carbon dioxide into sugar and oxygen.',
    '',
    'Chlorophyll: the green pigment that absorbs light in the leaf',
    'The **stroma** is the fluid where sugar is made in the chloroplast.',
  ].join('\n');
  it('finds a heading, a definition, and a bold term', () => {
    const found = generateCards(text);
    expect(found.map((one) => one.reason)).toEqual(['heading', 'definition', 'bold']);
    expect(found[2].card.front).toContain('{{stroma}}');
  });

  it('finds cards written in the page as "Q :: A" and "{{blank}}"', () => {
    const found = generateCards(['The {{sun}} is a star', 'Capital of France :: Paris'].join('\n'));
    expect(found.map((one) => one.card.kind)).toEqual(['cloze', 'basic']);
    expect(found.every((one) => one.reason === 'inline')).toBe(true);
  });
});

describe('text import and export', () => {
  it('reads quoted CSV with a header and a custom delimiter', () => {
    const rows = parseDelimited('Front,Back\r\n"a, b","say ""hi"""\r\nplain,x\r\n');
    expect(rows).toEqual([
      ['Front', 'Back'],
      ['a, b', 'say "hi"'],
      ['plain', 'x'],
    ]);
    expect(parseDelimited('a;b\nc;d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const parsed = cardsFromRows(rows);
    expect(parsed.cards.map((one) => one.front)).toEqual(['a, b', 'plain']);
  });
  it('counts what it could not read', () => {
    const parsed = cardsFromText('Q :: A\nno answer here\n\nThe {{x}} line');
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.skipped).toEqual([{ line: 2, reason: 'noAnswer' }]);
    expect(parseCards('Q :: A', 'notes.txt').cards).toHaveLength(1);
  });
  it('finds duplicates before adding', () => {
    const plan = planImport([card('1', 'a', 'b'), card('2', 'A', 'B'), card('3', 'c', 'd')], [card('x', 'c', 'd')]);
    expect(plan.fresh.map((one) => one.id)).toEqual(['1']);
    expect(plan.duplicates.map((one) => one.id)).toEqual(['2', '3']);
  });
  it('writes CSV and counts image cards it cannot write', () => {
    const deck: Deck = {
      id: 'd',
      name: 'D',
      cards: [
        card('1', 'Why, so?', 'Because'),
        { id: '2', kind: 'occlusion', front: 'Label it', back: '' },
        { id: '3', kind: 'choice', front: 'Pick', back: '', choices: ['x', 'y'], answer: 1 },
      ],
    };
    const { csv, skipped } = deckToCsv(deck);
    expect(skipped).toBe(1);
    expect(csv).toContain('"Why, so?",Because');
    expect(csv).toContain('"y\nOptions: x | y"');
  });
});
