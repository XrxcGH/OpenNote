import { describe, expect, it } from 'vitest';
import { imageFiles } from './insert';

const file = (name: string, type: string) => new File([new Uint8Array(4)], name, { type });

describe('imageFiles', () => {
  it('takes Windows metafiles as pictures, whatever type Windows gave them', () => {
    const { images, others } = imageFiles(
      [
        file('t.emf', 'image/x-emf'),
        file('t.emf', 'image/emf'),
        file('t.emf', ''),
        file('t.wmf', ''),
        file('notes.txt', 'text/plain'),
      ],
      false,
    );
    expect(images.map((image) => image.name)).toEqual(['t.emf', 't.emf', 't.emf', 't.wmf']);
    expect(others).toBe(1);
  });
});
