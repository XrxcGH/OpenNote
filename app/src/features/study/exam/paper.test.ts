// A practice exam as pages, the language model's questions and their checks, and missed questions to flashcards.
import { describe, expect, it, vi } from 'vitest';
import { checkItem, grounded, modelQuestions, passagesOf, readReply } from './model';
import { answerText, inline, keyMarkdown, paperMarkdown, resultsMarkdown } from './paper';
import type { ExamSource } from './sources';
import { cardOf, sendToDeck } from './toDeck';
import type { Exam, Question } from './types';
import { DEFAULT_SETTINGS } from './types';

const decks = vi.hoisted(() => ({ list: [] as { id: string; name: string; cards: { origin?: string }[] }[] }));
vi.mock('../deck/library', () => ({
  newId: (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`,
  decksStore: { get: () => decks.list },
  createDeck: (name: string) => {
    const deck = { id: `d${decks.list.length + 1}`, name, cards: [] };
    decks.list.push(deck);
    return deck;
  },
  saveCard: (deckId: string, card: { origin?: string }) => {
    decks.list.find((deck) => deck.id === deckId)?.cards.push(card);
  },
}));

const source = { pageId: 'p 1', title: 'Cells', topic: 'Organelles' };
const questions: Question[] = [
  {
    id: 'q1',
    kind: 'truefalse',
    prompt: 'True or false: ribosomes make proteins.',
    marks: 1,
    answer: 'true',
    guide: [],
    source,
  },
  {
    id: 'q2',
    kind: 'choice',
    prompt: 'Which organelle releases energy?',
    marks: 1,
    answer: 'Mitochondria',
    choices: ['Nucleus', 'Mitochondria', 'Ribosome'],
    correct: 1,
    guide: ['Mitochondria'],
    source,
  },
  {
    id: 'q3',
    kind: 'fill',
    prompt: 'Water moves by {{osmosis}}.',
    marks: 1,
    answer: 'osmosis',
    guide: ['osmosis'],
    source,
  },
  {
    id: 'q4',
    kind: 'worked',
    prompt: 'A train travels 150 km in 3 hours. Find its speed.',
    marks: 3,
    answer: '50 km/h',
    guide: ['Working: 150 / 3 = 50'],
    math: true,
    tolerance: 0.01,
    source,
  },
];
const exam: Exam = {
  id: 'e1',
  title: 'Cells exam',
  created: '2026-10-29T10:00:00.000Z',
  settings: { ...DEFAULT_SETTINGS, minutes: 20 },
  questions,
  engine: 'rules',
};

describe('paper and key', () => {
  it('writes the blank paper with marks, options, and blanks, and no answers', () => {
    const paper = paperMarkdown(exam);
    expect(paper).toContain('4 questions, 6 marks in all.');
    expect(paper).toContain('Time allowed: 20 minutes.');
    expect(paper).toContain('**2.** Which organelle releases energy? (1 mark)');
    expect(paper).toContain('- B. Mitochondria');
    expect(paper).toContain('**3.** Water moves by ________. (1 mark)');
    expect(paper).toContain('(3 marks)');
    expect(paper).not.toContain('osmosis');
    expect(paper).not.toContain('50 km/h');
  });

  it('writes the key with the right option, the guide, the tolerance, and the source', () => {
    const key = keyMarkdown(exam);
    expect(key).toContain('**1.** True (1 mark)');
    expect(key).toContain('**2.** B. Mitochondria (1 mark)');
    expect(key).toContain('- Working: 150 / 3 = 50');
    expect(key).toContain('Accept answers within 1 percent of this value, with the unit.');
    expect(key).toContain('From the notes: Cells');
  });

  it('writes the results with links back to weak topics', () => {
    const marks = {
      q1: { id: 'q1', got: 1, of: 1, auto: true, status: 'right' as const },
      q2: { id: 'q2', got: 0, of: 1, auto: true, status: 'wrong' as const },
      q3: { id: 'q3', got: 0, of: 1, auto: true, status: 'wrong' as const },
      q4: { id: 'q4', got: 0, of: 3, auto: false, status: 'unmarked' as const },
    };
    const results = resultsMarkdown(exam, { q1: { picked: 0 }, q2: { picked: 0 }, q4: { ink: [[[1, 1]]] } }, marks);
    expect(results).toContain('Score: 1 of 6 marks (17 percent)');
    expect(results).toContain('| 2 | 0 of 1 | A. Nucleus |');
    expect(results).toContain('| 3 | 0 of 1 | No answer |');
    expect(results).toContain('| 4 | Not marked | A handwritten answer, kept in the exam window. |');
    expect(results).toContain('- Organelles: 1 of 3 marks [Cells](opennote://page/p%201)');
  });

  it('keeps note text from breaking a line, a table, or a link', () => {
    expect(inline('a | b\n[c](d)')).toBe('a \\| b \\[c\\](d)');
    expect(answerText(questions[2] as Question, { blanks: ['  '] })).toBe('No answer');
  });
});

describe('language model questions', () => {
  const passages: ExamSource[] = [{ pageId: 'p1', title: 'Cells', text: 'Ribosomes make proteins from amino acids.' }];

  it('keeps a well-formed, grounded question and refuses the rest', () => {
    expect(
      checkItem({ kind: 'short', prompt: 'What do ribosomes make?', answer: 'proteins', source: 1 }, passages, 'm1'),
    ).toMatchObject({ kind: 'short', answer: 'proteins', source: { pageId: 'p1' } });
    // An answer the notes do not hold, a passage that does not exist, and a kind that is not known.
    expect(
      checkItem(
        { kind: 'short', prompt: 'What do ribosomes make?', answer: 'starch granules', source: 1 },
        passages,
        'm',
      ),
    ).toBeNull();
    expect(
      checkItem({ kind: 'short', prompt: 'What do ribosomes make?', answer: 'proteins', source: 4 }, passages, 'm'),
    ).toBeNull();
    expect(
      checkItem({ kind: 'essay', prompt: 'Discuss ribosomes.', answer: 'proteins', source: 1 }, passages, 'm'),
    ).toBeNull();
    expect(checkItem('nonsense', passages, 'm')).toBeNull();
  });

  it('needs the answer among 3 to 5 options', () => {
    const item = { kind: 'choice', prompt: 'What do ribosomes make?', answer: 'proteins', source: 1 };
    expect(checkItem({ ...item, choices: ['proteins', 'fats', 'sugars'] }, passages, 'm')).toMatchObject({
      correct: 0,
    });
    expect(checkItem({ ...item, choices: ['fats', 'sugars', 'salts'] }, passages, 'm')).toBeNull();
    expect(checkItem({ ...item, choices: ['proteins', 'fats'] }, passages, 'm')).toBeNull();
  });

  it('reads the JSON array out of a chatty reply and survives broken JSON', () => {
    expect(readReply('Here you go:\n```json\n[{"a": 1}]\n```')).toEqual([{ a: 1 }]);
    expect(readReply('[{"a": 1')).toEqual([]);
    expect(readReply('no array')).toEqual([]);
  });

  it('sends at most the passage limit and only the kinds asked for', async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify([
        { kind: 'truefalse', prompt: 'True or false: ribosomes make proteins.', answer: 'true', source: 1 },
        { kind: 'short', prompt: 'What do ribosomes make?', answer: 'proteins', source: 1 },
      ]),
    );
    const long: ExamSource[] = Array.from({ length: 30 }, (_, at) => ({
      pageId: `p${at}`,
      title: 'T',
      text: 'x'.repeat(5000),
    }));
    expect(passagesOf(long).reduce((sum, one) => sum + one.text.length, 0)).toBeLessThanOrEqual(12_000);
    const made = await modelQuestions({ generate }, passages, { length: 5, difficulty: 'standard', kinds: ['short'] });
    expect(made.map((one) => one.kind)).toEqual(['short']);
    expect(grounded('48', 'It went 48 km.')).toBe(true);
  });
});

describe('missed questions to flashcards', () => {
  it('makes a card of the matching kind and adds each question once', () => {
    expect(cardOf(questions[1] as Question, 'e1')).toMatchObject({ kind: 'choice', answer: 1, origin: 'exam:e1:q2' });
    expect(cardOf(questions[2] as Question, 'e1')).toMatchObject({
      kind: 'cloze',
      front: 'Water moves by {{osmosis}}.',
    });
    expect(cardOf(questions[0] as Question, 'e1')).toMatchObject({ kind: 'basic', back: 'True' });
    const first = sendToDeck(exam, [questions[1] as Question, questions[3] as Question]);
    expect(first).toMatchObject({ added: 2, deck: { name: 'Cells exam: missed questions' } });
    const again = sendToDeck(exam, [questions[1] as Question]);
    expect(again.added).toBe(0);
    expect(decks.list).toHaveLength(1);
  });
});
