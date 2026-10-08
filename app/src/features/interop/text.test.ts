// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { exportErrorText } from './text';

describe('exportErrorText', () => {
  it('explains a table export of a source with no table in plain words', () => {
    expect(exportErrorText({ code: 'noTables', message: 'there is no table in Notes' })).toBe(
      'There is no table here to export. Choose another format, or add a table first.',
    );
  });

  it('makes the host words a sentence', () => {
    expect(exportErrorText({ code: 'internal', message: 'the disk went away' })).toBe(
      'Something went wrong, and nothing was kept. The disk went away.',
    );
  });
});
