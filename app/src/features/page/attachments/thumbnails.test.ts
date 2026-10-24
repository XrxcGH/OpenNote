import { describe, expect, it } from 'vitest';
import { wantsThumbnail } from './thumbnails';
import { copyExtension } from './saveCopy';

describe('attachment thumbnails', () => {
  it('are asked for PDF and Office files only', () => {
    for (const name of ['scan.pdf', 'plan.DOCX', 'budget.xlsx', 'talk.pptx', 'notes.odt']) {
      expect(wantsThumbnail(name), name).toBe(true);
    }
    for (const name of ['table.csv', 'photo.png', 'setup.exe', 'song.mp3', 'readme', 'notes.txt']) {
      expect(wantsThumbnail(name), name).toBe(false);
    }
  });
});

describe('Save a copy', () => {
  it('keeps a plain extension for the Save dialog and falls back to bin', () => {
    expect(copyExtension('Lab report.pdf')).toBe('pdf');
    expect(copyExtension('archive.tar.GZ')).toBe('gz');
    expect(copyExtension('README')).toBe('bin');
    expect(copyExtension('odd.na-me')).toBe('bin');
  });
});
