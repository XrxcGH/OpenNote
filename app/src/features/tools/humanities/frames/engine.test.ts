import { describe, expect, it } from 'vitest';
import { kitHumanities } from '../../../../strings/en/kitHumanities';
import { frameHtml, frameTable, headings, parseOutline, searchFrames } from './engine';
import type { FrameEntry } from './engine';
import { FRAMES } from './frames';

const text = kitHumanities.frames;
const entries: FrameEntry[] = FRAMES.map((frame) => ({
  id: frame.id,
  group: frame.group,
  name: text.f[frame.id].name,
  keywords: text.f[frame.id].keywords,
  groupName: text.groups[frame.group],
}));

describe('note frames', () => {
  it('give the case brief its headings in order', () => {
    expect(headings(parseOutline(text.f.caseBrief.outline))).toEqual([
      'Facts',
      'Procedural history',
      'Issue',
      'Rule',
      'Application',
      'Holding',
      'Reasoning',
      'Notes',
    ]);
  });

  it('give the historiography matrix six columns and four empty rows', () => {
    const table = frameTable(parseOutline(text.f.historiography.outline));
    expect(table?.header).toEqual(['Historian', 'Thesis', 'Evidence', 'Method', 'Sources', 'Response']);
    expect(table?.rows).toEqual(Array.from({ length: 4 }, () => ['', '', '', '', '', '']));
  });

  it('list the policy memo first for the search memo', () => {
    expect(searchFrames('memo', entries)[0].id).toBe('policyMemo');
  });

  it('fill named rows and leave the other cells empty', () => {
    const table = frameTable(parseOutline(text.f.ethicsCase.outline));
    expect(table?.rows.map((row) => row[0])).toEqual([
      'Consequences (utilitarian)',
      'Duties and rights (deontology)',
      'Virtue and character',
      'Care and relationships',
    ]);
    expect(table?.rows.every((row) => row.length === 4 && row.slice(1).every((cell) => cell === ''))).toBe(true);
  });

  it('group bullets and numbered items into lists', () => {
    const blocks = parseOutline('# A\n- one\n- two\n1. first\n2. second\n> say more');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'bullets', 'numbered', 'prompt']);
  });

  it('escape the text it writes as page HTML', () => {
    expect(frameHtml(parseOutline('# A < B & C'), 'Use "this"')).toBe(
      '<p><em>Use &quot;this&quot;</em></p><h2>A &lt; B &amp; C</h2>',
    );
  });

  it('keep every frame valid: a name, headings or a table, and the table last', () => {
    for (const frame of FRAMES) {
      const blocks = parseOutline(text.f[frame.id].outline, frame.rows);
      expect(blocks.length, frame.id).toBeGreaterThan(0);
      const tables = blocks.filter((block) => block.kind === 'table');
      expect(tables.length, frame.id).toBeLessThanOrEqual(1);
      if (tables.length === 1) expect(blocks[blocks.length - 1].kind, frame.id).toBe('table');
    }
    expect(FRAMES.length).toBeGreaterThanOrEqual(40);
  });

  it('match nothing for a word no frame has, and everything for an empty search', () => {
    expect(searchFrames('zzzz', entries)).toEqual([]);
    expect(searchFrames('  ', entries)).toHaveLength(entries.length);
  });
});
