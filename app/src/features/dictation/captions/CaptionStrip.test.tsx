// The caption strip: closed until captions run, then the last phrases with the rough one, and a note when late.
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { CaptionStrip } from './CaptionStrip';
import { EMPTY } from './model';
import { captionWords, captionsOpen } from './store';

afterEach(() => {
  captionsOpen.set(false);
  captionWords.set(EMPTY);
});

describe('the caption strip', () => {
  it('is not there until captions are running', () => {
    renderUi(<CaptionStrip />);
    expect(screen.queryByRole('region', { name: 'Live captions' })).toBeNull();
  });

  it('shows the finished phrases and the one being said, and updates as words come', async () => {
    captionsOpen.set(true);
    captionWords.set({ lines: ['Welcome back.'], partial: 'today we cover', behindMs: 0, heard: true });
    renderUi(<CaptionStrip />);
    const region = await screen.findByRole('region', { name: 'Live captions' });
    expect(region.textContent).toContain('Welcome back.');
    expect(region.textContent).toContain('today we cover');
    act(() =>
      captionWords.set({ lines: ['Welcome back.', 'Today we cover cells.'], partial: '', behindMs: 0, heard: true }),
    );
    expect(region.textContent).toContain('Today we cover cells.');
    expect(region.textContent).not.toContain('today we cover ');
  });

  it('says when this computer is running behind', async () => {
    captionsOpen.set(true);
    captionWords.set({ lines: ['Hello.'], partial: '', behindMs: 9000, heard: true });
    renderUi(<CaptionStrip />);
    expect((await screen.findByRole('status')).textContent).toBe('Captions are running behind on this computer.');
  });

  it('says it is waiting before anyone has spoken', async () => {
    captionsOpen.set(true);
    renderUi(<CaptionStrip />);
    expect(await screen.findByText('Listening for speech')).toBeTruthy();
  });
});
