// Typing plain words must not parse the whole block for marks on each key (B12 typing gate), and an edit that
// removes a mark must still drop its record.
import { describe, expect, it, vi } from 'vitest';
import * as records from './records';
import { ReviewModel } from './model';

const C1 = '01m3sbcmt0000000000000c001';
const span = `<span data-comment="${C1}">checked</span>`;

describe('ReviewModel.rider parse', () => {
  it('parses the block once for a run of plain keystrokes', () => {
    const model = new ReviewModel();
    model.setBlock('b', {
      comments: {
        [C1]: { author: 'A', time: '2026-11-07T09:00:00.000Z', markdown: 'Hi', replies: [], resolved: false },
      },
    });
    let text = `${'word '.repeat(50)}${span} tail`;
    model.rider('b', text, `${text} `);
    text += ' ';
    const spy = vi.spyOn(records, 'markIdsInMarkdown');
    for (const key of 'abcdef') {
      model.rider('b', text, `${text}${key}`);
      text += key;
    }
    expect(spy).not.toHaveBeenCalled();
    expect(model.rider('b', text, 'plain')).toHaveLength(1);
  });
});
