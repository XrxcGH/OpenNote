// The seams text:scaffold adds: the text flags, the key table part, the catalog parts, and the render stubs. These
// check the wiring, not that the stubs are empty, so a lane that fills its own file never edits this test.
import { describe, expect, it } from 'vitest';
import { FLAGS } from '../../app/flags';
import { BUILT_IN_COMMAND_IDS, EDITOR_COMMAND_IDS } from '../../editor/commands/catalog';
import { TEXT_PARA_ENTRIES } from '../../editor/commands/textParaCatalog';
import { TEXT_RUN_ENTRIES } from '../../editor/commands/textRunCatalog';
import { paraStyle } from '../../editor/render/paraStyle';
import { runStyle } from '../../editor/render/runStyle';
import { BUILT_IN_PAGE_KEYS, PAGE_KEYS, mergeKeys } from './keys';
import { TEXT_KEYS } from './keys/text';

const NAMES = [
  'runFormats',
  'paraFormats',
  'fontPicker',
  'styles2',
  'formatPane',
  'ruler',
  'symbols',
  'language',
  'footnotes',
  'review',
  'layout',
  'pasteFidelity',
  'findFormat',
];

describe('the text flags', () => {
  it.each(NAMES)('registers text.%s with a description, off in every build', (name) => {
    const def = FLAGS.find((entry) => entry.id === `text.${name}`);
    expect(def?.description.length).toBeGreaterThan(10);
    expect(def?.enabled).toMatchObject({ dev: false, nightly: false, beta: false, stable: false });
  });
});

describe('the seams', () => {
  it('never lets a text key share an id with a built-in page command', () => {
    for (const key of Object.keys(TEXT_KEYS)) expect(BUILT_IN_PAGE_KEYS, key).not.toHaveProperty(key);
    expect(() => mergeKeys({ 'format.bold': { keys: ['Ctrl+Q'], scope: 'editor' } }, BUILT_IN_PAGE_KEYS)).toThrow(
      /format\.bold/,
    );
  });

  it('puts every key of the text part in the page key table', () => {
    for (const key of Object.keys(TEXT_KEYS)) expect(PAGE_KEYS, key).toHaveProperty(key);
  });

  it('puts every text catalog entry in the catalog, none on a built-in ID and none in both parts', () => {
    const run = Object.keys(TEXT_RUN_ENTRIES);
    const para = Object.keys(TEXT_PARA_ENTRIES);
    for (const id of [...run, ...para]) {
      expect(EDITOR_COMMAND_IDS, id).toContain(id);
      expect(BUILT_IN_COMMAND_IDS, id).not.toContain(id);
    }
    expect(run.filter((id) => para.includes(id))).toEqual([]);
    expect(EDITOR_COMMAND_IDS).toContain('format.bold');
  });

  it('keeps the render stubs returning declarations as strings', () => {
    for (const declarations of [runStyle({ bold: true }), paraStyle({ align: 'center' })]) {
      expect(typeof declarations).toBe('object');
      for (const value of Object.values(declarations)) expect(typeof value).toBe('string');
    }
  });
});
