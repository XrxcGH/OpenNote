// Checking off to-dos that live on pages: the box changes in the page's own text, and a repeating line gets its next
// copy with the date moved on. Everything else in the page is left exactly as it was.
import { describe, expect, it } from 'vitest';
import { addNextLine, boxAt, checkOffLine, setBoxAt } from './pageCheck';
import { nextLineEdit } from './repeatLine';

// 2026-10-07 is a Wednesday. The instant is noon in UTC, so the date is the same in the zone used below.
const NOW = Date.UTC(2026, 9, 7, 12, 0);
const ZONE = 'UTC';

describe('the box on a line', () => {
  const page = '# Plan\n- [ ] Read chapter 4 by Friday\n- [x] Email Dr. Lee\nplain line';

  it('says whether a line is an open or a checked box, or neither', () => {
    expect(boxAt(page, 1)).toBe('open');
    expect(boxAt(page, 2)).toBe('done');
    expect(boxAt(page, 3)).toBeNull();
    expect(boxAt(page, 9)).toBeNull();
  });

  it('checks and unchecks one line and touches no other', () => {
    expect(setBoxAt(page, 1, true)).toBe('# Plan\n- [x] Read chapter 4 by Friday\n- [x] Email Dr. Lee\nplain line');
    expect(setBoxAt(page, 2, false)).toBe('# Plan\n- [ ] Read chapter 4 by Friday\n- [ ] Email Dr. Lee\nplain line');
    expect(setBoxAt(page, 3, true)).toBeNull();
  });

  it('keeps the list marker and indent, numbered items included', () => {
    expect(setBoxAt('  1. [ ] Nested', 0, true)).toBe('  1. [x] Nested');
    expect(setBoxAt('* [ ] Star', 0, true)).toBe('* [x] Star');
  });
});

describe('the next copy of a repeating line', () => {
  it('moves the date words on, keeping the rest of the line', () => {
    const next = nextLineEdit('Water plants every week by Friday', NOW, ZONE);
    expect(next?.edit).toEqual({ from: 27, to: 33, text: '2026-10-16' });
    expect(next?.repeat.unit).toBe('week');
  });

  it('adds the date to the end of a line that had none', () => {
    const text = 'Lab report every Friday';
    const next = nextLineEdit(text, NOW, ZONE);
    expect(next?.edit).toEqual({ from: text.length, to: text.length, text: ' 2026-10-09' });
  });

  it('is nothing for a line that does not repeat', () => {
    expect(nextLineEdit('Read chapter 4 by Friday', NOW, ZONE)).toBeNull();
  });

  it('adds the line under the checked one, and under the items nested in it', () => {
    const page = '- [x] Water plants every week by Friday\n  - [ ] fern\n- [ ] Other';
    expect(addNextLine(page, 0, NOW, ZONE)).toBe(
      '- [x] Water plants every week by Friday\n  - [ ] fern\n- [ ] Water plants every week by 2026-10-16\n- [ ] Other',
    );
  });

  it('checks a repeating line off and adds the next in one step', () => {
    expect(checkOffLine('- [ ] Stand-up every weekday', 0, NOW, ZONE)).toBe(
      '- [x] Stand-up every weekday\n- [ ] Stand-up every weekday 2026-10-08',
    );
  });

  it('checks a line that does not repeat off and adds nothing', () => {
    expect(checkOffLine('- [ ] Read by Friday', 0, NOW, ZONE)).toBe('- [x] Read by Friday');
  });

  it('refuses a line with no box', () => {
    expect(checkOffLine('just text every week', 0, NOW, ZONE)).toBeNull();
  });
});
