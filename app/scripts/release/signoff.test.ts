// @vitest-environment node
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signoffTemplate } from './checklist-signoff.ts';
import { parseDevice, recordSignoff, withEntry } from './signoff.ts';

const TYPES = ['Surface Pro', 'Wacom tablet'];

describe('signoff.ts', () => {
  it('writes the sign-off file from the template, with the new entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'signoff-'));
    const path = recordSignoff(
      root,
      { version: '0.2.0-beta.1', item: 'docs', by: 'Ada', date: '2026-10-01' },
      TYPES,
      '2026-10-07',
    );
    expect(path).toBe('docs/releases/0.2.0-beta.1.signoff.json');
    const written = JSON.parse(readFileSync(join(root, path), 'utf8'));
    expect(written.items.docs).toEqual({ by: 'Ada', date: '2026-10-01' });
    expect(written.items.pen).toEqual({ by: '', date: '', notes: '', devices: [] });

    recordSignoff(
      root,
      { version: '0.2.0-beta.1', item: 'format', by: 'Ada', date: '2026-10-02' },
      TYPES,
      '2026-10-07',
    );
    const again = JSON.parse(readFileSync(join(root, path), 'utf8'));
    expect(again.items.docs.by).toBe('Ada');
    expect(again.items.format.date).toBe('2026-10-02');
  });

  it('refuses an entry the checklist would not count', () => {
    const blank = signoffTemplate('1.0.0');
    const input = { version: '1.0.0', item: 'docs', by: 'Ada', date: '2026-10-09' };
    expect(() => withEntry(blank, input, '2026-10-07', TYPES)).toThrow(/future/);
    expect(() => withEntry(blank, { ...input, by: ' ' }, '2026-10-07', TYPES)).toThrow(/No one/);
    expect(() => withEntry(blank, { ...input, item: 'vibes' }, '2026-10-07', TYPES)).toThrow(/not a checklist item/);
    expect(() => withEntry(blank, { ...input, version: '2.0.0' }, '2026-10-07', TYPES)).toThrow(/for 1.0.0/);
    const pen = { ...input, item: 'pen', date: '2026-10-01', devices: [parseDevice('Surface Pro=Pro 9')] };
    expect(() => withEntry(blank, pen, '2026-10-07', TYPES)).toThrow(/two different devices/);
  });

  it('adds a passing update test to the notes, and refuses a failing one', () => {
    const blank = signoffTemplate('1.0.0');
    const report = { from: '0.9.0-beta.3', to: '1.0.0', ok: true, detail: '0.9.0-beta.3 updated itself to 1.0.0.' };
    const input = { version: '1.0.0', item: 'updates', by: 'Ada', date: '2026-10-01', updateReport: report };
    expect(withEntry(blank, input, '2026-10-07', TYPES).items.updates?.notes).toBe(
      'Update test: 0.9.0-beta.3 updated itself to 1.0.0.',
    );
    const failed = { ...input, updateReport: { ...report, ok: false, detail: 'The update timed out.' } };
    expect(() => withEntry(blank, failed, '2026-10-07', TYPES)).toThrow(/timed out/);
  });

  it('reads devices as type=name', () => {
    expect(parseDevice('Wacom tablet=Intuos Pro')).toEqual({ type: 'Wacom tablet', name: 'Intuos Pro' });
    expect(() => parseDevice('Intuos')).toThrow(/<type>=<name>/);
  });
});
