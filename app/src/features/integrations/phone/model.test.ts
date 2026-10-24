import { describe, expect, it, vi } from 'vitest';
import { minutesLeft, pastePhotos, photoFiles, qrPath } from './model';

describe('phone scan model', () => {
  it('draws one square per dark module, inside the quiet zone', () => {
    expect(qrPath(['10', '01'])).toBe('M4 4h1v1h-1zM5 5h1v1h-1z');
    expect(qrPath(['00'])).toBe('');
  });

  it('counts whole minutes left, and none once time is up', () => {
    expect(minutesLeft(10 * 60_000, 0)).toBe(10);
    expect(minutesLeft(10 * 60_000 + 900, 0)).toBe(10);
    expect(minutesLeft(91_000, 0)).toBe(2);
    expect(minutesLeft(1_000, 0)).toBe(1);
    expect(minutesLeft(0, 5)).toBe(0);
  });

  it('turns only JPEG and PNG photos into files', () => {
    const files = photoFiles(
      [
        { mime: 'image/png', width: 1, height: 1, data: btoa('png') },
        { mime: 'image/gif' as 'image/png', width: 1, height: 1, data: btoa('gif') },
        { mime: 'image/jpeg', width: 1, height: 1, data: btoa('jpg') },
      ],
      new Date('2026-10-14T12:30:05Z'),
    );
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ['Phone 20261014-123005-1.png', 'image/png'],
      ['Phone 20261014-123005-2.jpg', 'image/jpeg'],
    ]);
  });

  it('pastes onto the page, and says when there is no page', () => {
    const target = new EventTarget();
    const heard = vi.fn();
    target.addEventListener('paste', heard);
    const added: File[] = [];
    const make = () => ({ items: { add: (file: File) => added.push(file) } }) as unknown as DataTransfer;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(pastePhotos(target, [file], make)).toBe(true);
    expect(heard).toHaveBeenCalledOnce();
    expect(added).toEqual([file]);
    expect(pastePhotos(null, [file], make)).toBe(false);
    expect(pastePhotos(target, [], make)).toBe(false);
  });
});
