// The page parts the tools draw: answers on math lines, the Graph this button, and due-date chips.
import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { findDuesIn } from './dueChipsExt';
import { notesDecorations, regionOfBrowser } from './notesExt';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    list: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph', attrs: { checked: { default: null } } },
    text: { group: 'inline' },
  },
});

const doc = (...lines: string[]) =>
  schema.node(
    'doc',
    null,
    lines.map((line) => schema.node('paragraph', null, line ? [schema.text(line)] : [])),
  );

const widgets = (set: ReturnType<typeof notesDecorations>) => set.find().length;

describe('math on page lines', () => {
  const region = { decimal: '.' as const, group: ',' };
  it('shows an answer for a question line and nothing for plain text', () => {
    expect(widgets(notesDecorations(doc('rent = 1,200', 'rent * 12 ='), region))).toBe(1);
    expect(widgets(notesDecorations(doc('Plain words', 'no sums here'), region))).toBe(0);
    expect(widgets(notesDecorations(doc('5 mi in km ='), region))).toBe(1);
  });
  it('offers Graph this for an equation', () => {
    expect(widgets(notesDecorations(doc('y = x^2'), region))).toBe(1);
  });
  it('reads the region from the browser', () => {
    expect(['.', ',']).toContain(regionOfBrowser().decimal);
  });
});

describe('due dates in the editor', () => {
  const NOW = Date.UTC(2026, 9, 7, 12, 0);
  it('finds a date at the end of a checkbox item or a tagged line only', () => {
    const task = schema.node('doc', null, [
      schema.node('list', null, [
        schema.node('listItem', { checked: false }, [
          schema.node('paragraph', null, [schema.text('Read chapter 4 by 2026-10-09')]),
        ]),
        schema.node('listItem', { checked: null }, [
          schema.node('paragraph', null, [schema.text('Plain item by 2026-10-09')]),
        ]),
      ]),
      schema.node('paragraph', null, [schema.text('Call the bank 2026-10-12 #todo')]),
      schema.node('paragraph', null, [schema.text('Plain note 2026-10-12')]),
    ]);
    const found = findDuesIn(task, NOW, 'UTC');
    expect(found.map((one) => one.phrase)).toEqual(['2026-10-09', '2026-10-12']);
  });
});
