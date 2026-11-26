// The video namespace keeps only its command words and the block's fallback in start-up; the rest loads with the
// video code. The start-up copies must match the full words, and loading the video code must fill in the rest.
import { expect, it } from 'vitest';
import { en } from '../../../strings/en';
import { video } from '../../../strings/en/video';
import { videoStart } from '../../../strings/en/videoStart';

it('keeps the same start-up words as video.ts, and the video code adds the rest', async () => {
  expect(videoStart.commands).toEqual(video.commands);
  expect(videoStart.block.unavailable).toBe(video.block.unavailable);
  await import('./text');
  expect(en.video).toEqual(video);
});
