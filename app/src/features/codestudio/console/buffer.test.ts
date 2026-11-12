import { describe, expect, it } from 'vitest';
import { ConsoleBuffer, lineText, MAX_LINES } from './buffer';

const E = '\u001b';

describe('the console buffer', () => {
  it('joins pieces into lines and keeps errors marked', () => {
    const buffer = new ConsoleBuffer();
    buffer.write('out', 'Hel');
    buffer.write('out', 'lo\nWor');
    buffer.write('err', 'oops\n');
    buffer.write('out', 'ld\n');
    expect(buffer.lines.map(lineText)).toEqual(['Hello', 'Woroops', 'ld']);
    expect(buffer.lines[1]!.spans.map((span) => span.err)).toEqual([false, true]);
  });

  it('keeps each stream’s color across pieces', () => {
    const buffer = new ConsoleBuffer();
    buffer.write('out', `${E}[32mgreen\nstill`);
    buffer.write('err', 'plain\n');
    expect(buffer.lines[1]!.spans).toEqual([
      { text: 'still', fg: 2, bold: false, err: false },
      { text: 'plain', fg: null, bold: false, err: true },
    ]);
  });

  it('echoes input and notes on lines of their own, and clears', () => {
    const buffer = new ConsoleBuffer();
    buffer.write('out', 'Name? ');
    buffer.echo('Ada');
    buffer.note('Finished');
    expect(buffer.lines.map((line) => [line.kind, lineText(line)])).toEqual([
      ['output', 'Name? '],
      ['input', 'Ada'],
      ['note', 'Finished'],
    ]);
    expect(buffer.text()).toBe('Name? \nAda\nFinished');
    buffer.clear();
    expect(buffer.lines).toEqual([]);
  });

  it('keeps at most MAX_LINES lines', () => {
    const buffer = new ConsoleBuffer();
    buffer.write('out', 'x\n'.repeat(MAX_LINES + 10));
    expect(buffer.lines).toHaveLength(MAX_LINES);
  });
});

describe('the console buffer and blank lines', () => {
  it('keeps a blank line for each line feed with nothing before it', () => {
    const buffer = new ConsoleBuffer();
    buffer.write('out', 'a\n\nb\n');
    expect(buffer.lines.map(lineText)).toEqual(['a', '', 'b']);
    expect(buffer.text()).toBe('a\n\nb');
    // A bare print() writes one line feed: one blank line.
    buffer.write('out', '\n');
    expect(buffer.lines.map(lineText)).toEqual(['a', '', 'b', '']);
    // Text split across writes still makes one line.
    buffer.write('out', 'c');
    buffer.write('out', 'd\n');
    expect(buffer.lines.map(lineText)).toEqual(['a', '', 'b', '', 'cd']);
  });
});
