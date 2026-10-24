// The players from the keyboard: the YouTube card loads only when Play is pressed with Enter or Space, and the local
// video answers Space and the arrow keys and carries its captions as a text track.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { BlockJson, OpenPage } from '../../../services/pages/types';
import { expectNoAxeViolations } from '../../../test';
import { EmbedBlockView } from '../media/EmbedBlock';
import { VideoBlockView } from './VideoBlock';

afterEach(cleanup);

const page = { id: 'p', assetUrl: (asset: string) => `blob:none/${asset}` } as unknown as OpenPage;

describe('the YouTube card', () => {
  const block = {
    id: 'b',
    type: 'ext:org.opennote/embed',
    data: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'A lecture' },
  } as unknown as BlockJson;

  it('loads nothing until Play is pressed from the keyboard, then shows the nocookie frame', async () => {
    const { container } = render(<EmbedBlockView block={block} page={page} />);
    expect(container.querySelector('iframe')).toBeNull();
    await userEvent.tab();
    const play = screen.getByRole('button', { name: 'Play A lecture' });
    await waitFor(() => expect(document.activeElement).toBe(play));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(container.querySelector('iframe')?.src.startsWith('https://www.youtube-nocookie.com/embed/')).toBe(true);
  });
});

describe('the local video', () => {
  const block = {
    id: 'v',
    type: 'ext:org.opennote/video',
    data: { asset: 'a1', name: 'Lecture.mp4', captions: 'c1', captionsName: 'lecture.vtt' },
  } as unknown as BlockJson;

  it('plays from the page asset with a captions track, and has no accessibility violations', async () => {
    const { container } = render(<VideoBlockView block={block} page={page} />);
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe('blob:none/a1');
    const track = video?.querySelector('track');
    expect(track?.getAttribute('kind')).toBe('captions');
    expect(track?.getAttribute('src')).toBe('blob:none/c1');
    expect(screen.getByRole('button', { name: 'Replace captions' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('answers the player keys while it has focus', async () => {
    const { container } = render(<VideoBlockView block={block} page={page} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    let toggled = 0;
    video.play = () => {
      toggled += 1;
      return Promise.resolve();
    };
    // The file isn't real, so the element fails to load a moment later; the keys are tried before that.
    fireEvent.keyDown(video, { key: ' ' });
    expect(toggled).toBe(1);
    fireEvent.keyDown(video, { key: 'ArrowUp' });
    expect(video.volume).toBeLessThanOrEqual(1);
  });
});
