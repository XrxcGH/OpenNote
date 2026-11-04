// The seams text:scaffold adds: the text flags, the key table part, the catalog parts, and the render stubs.
import { describe, expect, it } from 'vitest';
import { FLAGS } from '../../app/flags';
import { EDITOR_COMMAND_IDS } from '../../editor/commands/catalog';
import { paraStyle } from '../../editor/render/paraStyle';
import { runStyle } from '../../editor/render/runStyle';
import { PAGE_KEYS } from './keys';
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
  it.each(NAMES)('registers text.%s with a description, off in Nightly, Beta, and Stable', (name) => {
    const def = FLAGS.find((entry) => entry.id === `text.${name}`);
    expect(def?.description.length).toBeGreaterThan(10);
    expect(def?.enabled).toMatchObject({ nightly: false, beta: false, stable: false });
  });
});

describe('the stubs', () => {
  it('start empty, so lanes add to files only they own', () => {
    expect(Object.keys(TEXT_KEYS)).toEqual([]);
    for (const key of Object.keys(TEXT_KEYS)) expect(PAGE_KEYS).toHaveProperty(key);
    expect(EDITOR_COMMAND_IDS).toContain('format.bold');
    expect(runStyle({ bold: true })).toEqual({});
    expect(paraStyle({ align: 'center' })).toEqual({});
  });
});
