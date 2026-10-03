import { describe, expect, it } from 'vitest';
import type { BlockJson } from '../../../services/pages/types';
import { extractTitle, mergeBlocks, splitAtHeadings } from './sections';

const text = (id: string, markdown: string): BlockJson => ({
  id,
  type: 'text',
  order: id,
  created: '',
  modified: '',
  data: { markdown },
});
const other = (id: string, type: string): BlockJson => ({
  id,
  type,
  order: id,
  created: '',
  modified: '',
  data: type === 'table' ? { header: false, columns: [], rows: [] } : { asset: 'a' },
});

describe('split at headings', () => {
  it('cuts at the least heading level and keeps what comes before', () => {
    const result = splitAtHeadings([
      text('a', 'Intro line\n\n## Cells\n\nAbout cells\n\n### Nucleus\n\nDetail\n\n## Tissue\n\nAbout tissue'),
    ]);
    expect(result?.level).toBe(2);
    expect(result?.intro.map((b) => b.data.markdown)).toEqual(['Intro line']);
    expect(result?.sections.map((s) => s.title)).toEqual(['Cells', 'Tissue']);
    expect(result?.sections[0].blocks.map((b) => b.data.markdown)).toEqual(['About cells\n\n### Nucleus\n\nDetail']);
    expect(result?.sections[1].blocks.map((b) => b.data.markdown)).toEqual(['About tissue']);
  });

  it('follows sections across blocks, with tables, and counts what cannot move', () => {
    const result = splitAtHeadings([
      text('a', '# One\n\nfirst'),
      other('t', 'table'),
      other('i', 'image'),
      text('b', '# Two\n\nsecond'),
    ]);
    expect(result?.sections.map((s) => s.title)).toEqual(['One', 'Two']);
    expect(result?.sections[0].blocks.map((b) => b.type)).toEqual(['text', 'table']);
    expect(result?.skipped).toBe(1);
  });

  it('has nothing to split without headings', () => {
    expect(splitAtHeadings([text('a', 'No headings here.')])).toBeNull();
  });
});

describe('merge pages', () => {
  it('puts each title as a heading before its text and tables', () => {
    const blocks = mergeBlocks([
      { title: 'Monday', blocks: [text('a', 'Did things'), other('i', 'image')] },
      { title: 'Tuesday', blocks: [other('t', 'table')] },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'text', 'table']);
    expect(blocks.map((b) => b.data.markdown)).toEqual(['# Monday', 'Did things', '# Tuesday', undefined]);
  });
});

describe('extract', () => {
  it('names the page for the first heading or words', () => {
    expect(extractTitle('## Key terms\n\nlist', 'Extract')).toBe('Key terms');
    expect(extractTitle('Some long first line of text that goes on and on and on and on and on and on', 'x', 20)).toBe(
      'Some long first lin…',
    );
    expect(extractTitle('', 'Extracted text')).toBe('Extracted text');
  });
});
