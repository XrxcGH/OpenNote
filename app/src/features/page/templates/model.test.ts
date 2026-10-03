import { describe, expect, it } from 'vitest';
import type { BlockJson } from '../../../services/pages/types';
import { expandPlaceholders, fromTemplate, previewOf, seriesBase, seriesBlocks, seriesStructure } from './model';

const values = { date: 'Oct 3, 2026', time: '2:05 PM', title: 'Weekly review' };
const text = (markdown: string): BlockJson => ({
  id: 'b',
  type: 'text',
  order: 'a',
  created: '',
  modified: '',
  data: { markdown },
});

describe('page templates', () => {
  it('fills in the date, the time, and the title', () => {
    const filled = expandPlaceholders('{{date}} at {{ time }}: {{Title}}', values);
    expect(filled.text).toBe('Oct 3, 2026 at 2:05 PM: Weekly review');
    expect(filled.cursor).toBe(false);
  });

  it('copies text and tables as new blocks and finds the cursor', () => {
    const blocks: BlockJson[] = [
      text('# {{title}}\n\nNotes for {{date}}\n\n- [ ] Agenda {{cursor}}'),
      { ...text(''), id: 'empty' },
      {
        id: 't',
        type: 'table',
        order: 'b',
        created: '',
        modified: '',
        data: {
          header: true,
          columns: [{ id: 'c1', width: 100 }],
          rows: [{ id: 'r1', cells: { c1: { markdown: '{{date}}' } } }],
        },
      },
      { id: 'i', type: 'image', order: 'c', created: '', modified: '', data: { asset: 'a1' } },
    ];
    const { blocks: out, cursor } = fromTemplate(blocks, values);
    expect(out.map((block) => block.type)).toEqual(['text', 'table']);
    expect(out[0].data.markdown).toBe('# Weekly review\n\nNotes for Oct 3, 2026\n\n- [ ] Agenda ');
    expect(JSON.stringify(out[1].data)).toContain('Oct 3, 2026');
    expect(cursor?.block).toBe(out[0].id);
    expect(cursor?.pos).toBeGreaterThan(10);
  });

  it('leaves the cursor out of the text', () => {
    const { blocks } = fromTemplate([text('a {{cursor}} b {{cursor}}')], values);
    expect(String(blocks[0].data.markdown)).not.toMatch(/\{\{|\uE000/);
  });

  it('previews the first words', () => {
    expect(previewOf([text('# Weekly review\n\nGoals')])).toBe('Weekly review Goals');
    expect(previewOf([])).toBe('');
  });
});

describe('series pages', () => {
  const last =
    '# Agenda\n\nWe talked about things.\n\n- [x] Send notes\n- [ ] Book room\n- [ ] Call Sam\n\n## Next steps\n\n> a quote';

  it('keeps headings and carries only unfinished items', () => {
    expect(seriesStructure(last, true)).toBe('# Agenda\n\n- [ ] Book room\n- [ ] Call Sam\n\n## Next steps');
  });

  it('keeps every item, reset, when nothing is carried', () => {
    expect(seriesStructure(last, false)).toBe(
      '# Agenda\n\n- [ ] Send notes\n- [ ] Book room\n- [ ] Call Sam\n\n## Next steps',
    );
  });

  it('drops prose-only text and lists without tasks', () => {
    expect(seriesStructure('Just words\n\n- plain item', true)).toBe('');
  });

  it('builds the page with a date line and a link back', () => {
    const blocks = seriesBlocks([text(last)], {
      dateLine: 'Oct 10, 2026',
      previous: { title: 'Weekly review · Oct 3, 2026', page: 'p1' },
      previousLabel: 'Before:',
      carry: true,
    });
    expect(blocks.map((block) => block.data.markdown)).toEqual([
      'Oct 10, 2026',
      'Before: [Weekly review · Oct 3, 2026](opennote:page/p1)',
      '# Agenda\n\n- [ ] Book room\n- [ ] Call Sam\n\n## Next steps',
    ]);
  });

  it('names the series without the last date', () => {
    expect(seriesBase('Weekly review · Oct 3, 2026')).toBe('Weekly review');
    expect(seriesBase('Standup - Sep 30, 2026')).toBe('Standup');
    expect(seriesBase('Plain title')).toBe('Plain title');
  });
});
