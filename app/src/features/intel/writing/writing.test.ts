import { describe, expect, it } from 'vitest';
import { changeCount, diffWords } from './diff';
import { makeList, proofread, rewritePlain, ruleBasedEngine, shorten, tidyStructure, toItems } from './ops';

const rebuild = (runs: ReturnType<typeof diffWords>, keep: 'before' | 'after') =>
  runs
    .filter((run) => run.kind === 'same' || run.kind === (keep === 'before' ? 'del' : 'add'))
    .map((run) => run.text)
    .join('');

describe('the marked changes', () => {
  it('shows what was added and removed, and rebuilds both texts', () => {
    const before = 'The cat sat on teh mat.';
    const after = 'The cat sat on the mat.';
    const runs = diffWords(before, after);
    expect(rebuild(runs, 'before')).toBe(before);
    expect(rebuild(runs, 'after')).toBe(after);
    expect(runs.filter((run) => run.kind !== 'same').map((run) => run.text)).toEqual(['teh', 'the']);
    expect(changeCount(runs)).toBe(1);
  });

  it('has no changes for the same text', () => {
    expect(changeCount(diffWords('Same text.', 'Same text.'))).toBe(0);
  });

  it('shows a text too long to compare as one removal and one addition', () => {
    const long = 'word '.repeat(3200);
    expect(diffWords(long, `${long}more`).map((run) => run.kind)).toEqual(['del', 'add']);
  });
});

describe('proofread', () => {
  it('fixes spacing, doubled words, capitals, and common slips', () => {
    expect(proofread('i think teh the plan is good ,because we  cant wait.Next step')).toBe(
      "I think the plan is good, because we can't wait. Next step",
    );
  });

  it('leaves abbreviations, i.e., and decimals alone', () => {
    expect(proofread('Use tools, e.g. a saw, i.e. something sharp. It costs 3.50 today.')).toBe(
      'Use tools, e.g. a saw, i.e. something sharp. It costs 3.50 today.',
    );
  });

  it('keeps words that are right twice in a row', () => {
    expect(proofread('She had had enough.')).toBe('She had had enough.');
  });
});

describe('rewrite, shorten, and lists', () => {
  it('uses plainer words and keeps a capital letter', () => {
    expect(rewritePlain('Utilize the form in order to obtain help. However, it requires approval.')).toBe(
      'Use the form to get help. But, it needs approval.',
    );
  });

  it('cuts filler and keeps the first sentence when it drops others', () => {
    expect(shorten('It is really very good. I think that we should just go.')).toBe('It is good. We should go.');
    const long =
      'The harbor opens at six. Boats leave in a line. Fish are sold at the dock. The market is busy and loud. ' +
      'Coffee is served nearby. Gulls circle above the pier. Prices change each day. The harbor closes at night.';
    const short = shorten(long);
    expect(short.startsWith('The harbor opens at six.')).toBe(true);
    expect(short.length).toBeLessThan(long.length);
  });

  it('makes a list from lines, sentences, or the parts of one sentence', () => {
    expect(toItems('- milk\n2) eggs\nbread;')).toEqual(['milk', 'eggs', 'bread']);
    expect(makeList('Buy milk. Call Sam. Book the trip.')).toBe('- Buy milk\n- Call Sam\n- Book the trip');
    expect(makeList('We need flour, eggs, and then sugar')).toBe('- We need flour\n- Eggs\n- Sugar');
  });

  it('tidies bullets, numbering, spaces, and blank lines', () => {
    expect(tidyStructure('\n• one  \n\n\n\n– two\n1) first\n2) second\n')).toBe('- one\n\n- two\n1. first\n2. second');
  });

  it('says a list or tidied bullets are Markdown and plain words are not', async () => {
    expect((await ruleBasedEngine.run('list', 'a. b.')).markdown).toBe(true);
    expect((await ruleBasedEngine.run('proofread', 'teh')).markdown).toBe(false);
    expect((await ruleBasedEngine.run('tidy', '• a')).markdown).toBe(true);
  });
});
