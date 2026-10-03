// @vitest-environment node
// Runs the notes contract suite against the reference model, which proves that the suite and the model agree.
// Each service implementation runs the same suite in its own test file.

import { describe, expect, it } from 'vitest';
import { CONTRACT_CASE_IDS, describeNotesService } from './contract';
import { createModelService } from './contract/model-service';
import { NotesModel } from './contract/model';
import { deep, large, parseFixture, sample } from './fixtures';

describeNotesService('reference model', async () => createModelService());

describe('the contract suite', () => {
  it('has about 60 cases with unique ids', () => {
    expect(CONTRACT_CASE_IDS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(CONTRACT_CASE_IDS).size).toBe(CONTRACT_CASE_IDS.length);
  });

  it('refuses todo ids it does not know', () => {
    expect(() => describeNotesService('typo', async () => createModelService(), { todo: ['no.such-case'] })).toThrow(
      'no.such-case',
    );
  });
});

describe('fixtures', () => {
  it('seeds the sample library as the wireframes show it', () => {
    const model = new NotesModel({ seed: 'sample' });
    expect(model.listNotebooks().map((node) => node.title)).toEqual([
      'Biology 101',
      'Work',
      'Personal',
      'Recipes',
      'Travel',
    ]);
    expect(model.listChildren('s-lectures').map((page) => `${page.title}:${page.pageLevel}`)).toEqual([
      'Cell structure:0',
      'Membranes:1',
      'Mitosis:0',
      'Meiosis:0',
      'Photosynthesis:0',
    ]);
  });

  it('builds the large library with 1,000 pages in one section', () => {
    const model = new NotesModel({ seed: large() });
    expect(model.listNotebooks()).toHaveLength(5);
    expect(model.listNotebooks().reduce((sum, notebook) => sum + notebook.childCount, 0)).toBe(50);
    expect(model.listChildren('lg-s-1-1')).toHaveLength(1000);
  });

  it('nests section groups in the deep library', () => {
    const model = new NotesModel({ seed: deep() });
    const tree = model.loadInitial(['d-n-1', 'd-g-1', 'd-g-2', 'd-g-3', 'd-g-4', 'd-s-leaf', 'd-p-3']);
    expect(tree.resolvedPath).toHaveLength(7);
    expect(tree.page?.pageLevel).toBe(2);
  });

  it('round-trips through JSON and rejects anything else', () => {
    expect(parseFixture(JSON.stringify(sample()))).toEqual(sample());
    expect(parseFixture('{"folder": 1}')).toBeNull();
    expect(parseFixture('not json')).toBeNull();
    expect(parseFixture('{"folder": "x", "notebooks": [{"id": 1}]}')).toBeNull();
  });
});
