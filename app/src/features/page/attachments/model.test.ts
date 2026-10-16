import { describe, expect, it } from 'vitest';
import type { BlockJson } from '../../../services/pages/types';
import { extensionOf, fileKind, formatSize, isTextual, previewLines, savedBackEdits } from './model';

const block = (id: string, type: string, asset: string): BlockJson => ({
  id,
  type,
  order: id,
  created: '',
  modified: '',
  data: { asset },
});
const saved = {
  page: 'p',
  previous: 'old',
  asset: { id: 'new', asset: { file: 'f', mime: 'x', bytes: 1, sha256: '', name: 'a.docx', created: '' } },
};

describe('attachments', () => {
  it('labels files by their extension', () => {
    expect(fileKind('Budget 2026.XLSX')).toEqual({ label: 'XLSX', family: 'excel' });
    expect(fileKind('notes.docx').family).toBe('word');
    expect(fileKind('deck.pptx').family).toBe('powerpoint');
    expect(fileKind('scan.pdf').family).toBe('pdf');
    expect(fileKind('README')).toEqual({ label: 'FILE', family: 'other' });
    expect(extensionOf('.hidden')).toBe('');
  });

  it('shows sizes for people', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(24_000)).toBe('24 KB');
    expect(formatSize(1_500_000)).toBe('1.5 MB');
    expect(formatSize(250_000_000)).toBe('250 MB');
  });

  it('previews only text, a few lines at a time', () => {
    expect(isTextual('a.csv', 'text/csv')).toBe(true);
    expect(isTextual('a.docx', 'application/octet-stream')).toBe(false);
    expect(previewLines('a\nb\nc\nd', 2)).toBe('a\nb');
    expect(previewLines('x'.repeat(200), 1, 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('points the attachment at the saved version and drops the old one', () => {
    const edits = savedBackEdits([block('b1', 'file', 'old'), block('b2', 'file', 'other')], saved);
    expect(edits).toEqual([
      { edit: 'addAsset', asset: 'new' },
      { edit: 'patchBlock', block: 'b1', data: { asset: 'new' } },
      { edit: 'removeAsset', asset: 'old' },
    ]);
  });

  it('keeps the old asset while another block still uses it', () => {
    const edits = savedBackEdits([block('b1', 'file', 'old'), block('b2', 'image', 'old')], saved);
    expect(edits?.some((edit) => edit.edit === 'removeAsset')).toBe(false);
  });

  it('ignores a save for a file nothing points at', () => {
    expect(savedBackEdits([block('b1', 'file', 'other')], saved)).toBeNull();
  });

  it('points a block an undo took back to an earlier version at the latest save', () => {
    // F3-2: saved back as v2, undone to v1, then saved again as v3. The block shows v1, not the v2 the copy last
    // was, and must still get v3.
    const again = { ...saved, previous: 'v2', replaces: ['v1', 'v2'], asset: { ...saved.asset, id: 'v3' } };
    expect(savedBackEdits([block('b1', 'file', 'v1')], again)).toEqual([
      { edit: 'addAsset', asset: 'v3' },
      { edit: 'patchBlock', block: 'b1', data: { asset: 'v3' } },
      { edit: 'removeAsset', asset: 'v1' },
    ]);
    // A save whose bytes match the version the block shows already changes nothing.
    const same = { ...again, asset: { ...saved.asset, id: 'v1' } };
    expect(savedBackEdits([block('b1', 'file', 'v1')], same)).toBeNull();
  });
});
