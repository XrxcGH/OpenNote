import { describe, expect, it } from 'vitest';
import type { TaggedBlock } from '../../../services/search/types';
import { groupLines, linesOf, setTaskBox, summaryMarkdown } from './summary';

const block = (patch: Partial<TaggedBlock> = {}): TaggedBlock => ({
  page: 'p1',
  title: 'Biology',
  notebook: 'n1',
  section: 's1',
  modified: Date.UTC(2026, 9, 3, 12),
  block: 'b1',
  markdown: 'Intro\n\nWhat is a cell?\n\n- [ ] read chapter 3\n- [x] sign up\n- plain item',
  ids: ['e1', 'e2', 'e3', 'e4', 'e5'],
  tags: { e2: ['question'], e3: ['todo'] },
  checked: [],
  ...patch,
});

describe('tag summary', () => {
  it('reads tagged lines and open checkboxes, and not finished ones', () => {
    const lines = linesOf(block());
    expect(lines.map((line) => [line.text, line.tags, line.box])).toEqual([
      ['What is a cell?', ['question'], null],
      ['read chapter 3', ['todo'], 'open'],
    ]);
  });

  it('lists a task item that has no tag as an open checkbox', () => {
    const lines = linesOf(block({ tags: {} }));
    expect(lines.map((line) => [line.text, line.box, line.boxKind, line.taskIndex])).toEqual([
      ['read chapter 3', 'open', 'task', 0],
    ]);
  });

  it('shows a To do line as done when its ID is checked', () => {
    expect(linesOf(block({ checked: ['e3'] }))[1].box).toBe('done');
  });

  it('groups by tag, page, or date', () => {
    const lines = linesOf(block());
    expect(groupLines(lines, 'tag', 'Open').map((group) => group.label)).toEqual(['Question', 'To do']);
    expect(groupLines(lines, 'page', 'Open').map((group) => group.label)).toEqual(['Biology']);
    expect(groupLines(lines, 'date', 'Open')).toHaveLength(1);
  });

  it('writes a summary page that links back', () => {
    const text = summaryMarkdown(groupLines(linesOf(block()), 'tag', 'Open'));
    expect(text).toContain('## To do\n\n- [ ] read chapter 3 [[Biology]]');
    expect(text).toContain('## Question\n\n- What is a cell? [[Biology]]');
  });

  it('checks the nth task item and skips code fences', () => {
    const md = '```\n- [ ] not a task\n```\n- [ ] first\n- [ ] second';
    expect(setTaskBox(md, 1, true)).toBe('```\n- [ ] not a task\n```\n- [ ] first\n- [x] second');
    expect(setTaskBox(md, 5, true)).toBeNull();
  });
});
