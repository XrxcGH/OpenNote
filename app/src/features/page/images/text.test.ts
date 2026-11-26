// The images namespace keeps only its command words in start-up; the rest loads with the image code. The start-up
// copies must match the full words, and loading the image code must fill in the rest.
import { expect, it } from 'vitest';
import { en } from '../../../strings/en';
import { images } from '../../../strings/en/images';
import { imagesStart } from '../../../strings/en/imagesStart';

it('keeps the same start-up words as images.ts, and the image code adds the rest', async () => {
  for (const [key, value] of Object.entries(imagesStart)) expect(images[key as keyof typeof imagesStart]).toBe(value);
  await import('./text');
  expect(en.images).toEqual(images);
});
