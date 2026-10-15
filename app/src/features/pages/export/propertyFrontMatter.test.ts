import { describe, expect, it } from 'vitest';

import { exportMarkdown } from './toMarkdown';
import { readExportPage } from './source';
import { propertyFrontMatter, yamlQuoted } from './propertyFrontMatter';

const fields = [
  { id: 'f1', name: 'Status', type: 'choice', value: 'Draft', options: ['Draft', 'Done'] },
  { id: 'f2', name: 'Due', type: 'date', value: '2026-10-01' },
  { id: 'f3', name: 'Rating', type: 'number', value: 4.5 },
  { id: 'f3b', name: 'Pages', type: 'number', value: 12 },
  { id: 'f4', name: 'Reviewed', type: 'checkbox', value: true },
  { id: 'f5', name: 'Related', type: 'page', value: '01m3sa12426sg32pmtyffjaqcf', label: 'Week "1"' },
  { id: 'f6', name: 'Course', type: 'text', value: null },
  { id: 'f7', name: 'Status', type: 'text', value: 'a second Status is left out' },
  { id: 'f8', name: '  ', type: 'text', value: 'no name' },
  { id: 'f9', name: 'Line\nbreak', type: 'text', value: 3 },
  { id: 'f10', name: 'Unknown', type: 'mystery', value: 'left out' },
  { name: 'No ID', type: 'text', value: 'left out' },
];

// The same lines as the core's golden test (crates/core/src/format/readable/tests.rs), so page.md and an export agree.
const EXPECTED = [
  'properties:',
  '  "Status": "Draft"',
  '  "Due": "2026-10-01"',
  '  "Rating": 4.5',
  '  "Pages": 12',
  '  "Reviewed": true',
  '  "Related": "Week \\"1\\""',
  '  "Course": null',
  '  "Line break": null',
];

describe('page properties in front matter', () => {
  it('writes the same properties block as page.md', () => {
    expect(propertyFrontMatter({ properties: { fields } })).toEqual(EXPECTED);
  });

  it('writes nothing for a page without fields', () => {
    expect(propertyFrontMatter(null)).toEqual([]);
    expect(propertyFrontMatter({ properties: { fields: [] } })).toEqual([]);
    expect(propertyFrontMatter({ properties: 'odd' })).toEqual([]);
  });

  it('escapes characters YAML readers take as line breaks', () => {
    expect(yamlQuoted('a\u2028b\u0085')).toBe('"a\\u2028b\\u0085"');
  });

  it('is in the Markdown export, after the tags', () => {
    const page = readExportPage({
      id: 'p',
      title: 'Cell',
      tags: ['bio'],
      created: '',
      modified: '',
      view: { properties: { fields: [fields[0]] } },
      blocks: [],
    });
    expect(exportMarkdown(page).markdown).toBe(
      '---\ntitle: "Cell"\ntags: ["bio"]\nproperties:\n  "Status": "Draft"\n---\n\n# Cell\n',
    );
  });
});
