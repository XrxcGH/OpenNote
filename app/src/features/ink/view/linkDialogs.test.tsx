// The dialogs of links on handwriting: the list a keyboard or screen reader walks, and the Make link question.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { InkHost } from './host';
import { inkLinks, linksOf } from './inkLinks';
import { askLinkTarget, showLinkList } from './linkDialogs';
import type { InkSurface } from './surface';

afterEach(() => inkLinks.set(new Map()));

const surface = { strokes: (ids: string[]) => ids.map((id) => ({ id, block: 'B1' })) } as unknown as InkSurface;

describe('the list of links on a page', () => {
  it('names each link and its target, and selects the writing', async () => {
    inkLinks.set(
      linksOf({
        inkLinks: {
          a: {
            block: 'B1',
            strokes: ['s1', 's2'],
            label: 'Lab notes',
            target: { kind: 'page', page: 'P1', heading: 'Method' },
          },
          b: { block: 'B1', strokes: ['s3'], label: 'Site', target: { kind: 'url', url: 'https://example.com' } },
        },
      }),
    );
    const select = vi.fn();
    const closed = showLinkList({ select } as unknown as InkHost, surface);
    const dialog = await screen.findByRole('dialog', { name: 'Links on this page' });
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Lab notes');
    expect(items[0].textContent).toContain('Heading: Method');
    expect(items[1].textContent).toContain('https://example.com');
    await userEvent.click(within(items[0]).getByRole('button', { name: 'Select' }));
    expect(select).toHaveBeenCalledWith({ blocks: [], strokes: ['s1', 's2'] }, { announce: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await closed;
  });

  it('says so when the page has no links', async () => {
    const closed = showLinkList({} as unknown as InkHost, surface);
    const dialog = await screen.findByRole('dialog', { name: 'Links on this page' });
    expect(dialog.textContent).toContain('No links on this page yet');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await closed;
  });
});

describe('Make link', () => {
  it('asks for a web address, refuses one that could run code, and answers with the target', async () => {
    const answer = askLinkTarget({} as unknown as InkHost, '');
    const dialog = await screen.findByRole('dialog', { name: 'Make link' });
    expect(within(dialog).queryByRole('radio', { name: /recording/i })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'A web address' }));
    const field = within(dialog).getByRole('textbox', { name: 'Web address' });
    await userEvent.clear(field);
    await userEvent.type(field, 'javascript:alert(1)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make link' }));
    expect(dialog.textContent).toContain('Use an address that starts with');
    await userEvent.clear(field);
    await userEvent.type(field, 'https://example.com/lab');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make link' }));
    expect(await answer).toEqual({
      target: { kind: 'url', url: 'https://example.com/lab' },
      label: 'https://example.com/lab',
    });
  });

  it('offers the recording only when the page has one, and cancels to null', async () => {
    const answer = askLinkTarget({ audio: {} } as unknown as InkHost, 'Plan');
    const dialog = await screen.findByRole('dialog', { name: 'Make link' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'The recording, at this moment' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make link' }));
    expect(await answer).toEqual({ target: { kind: 'recording' }, label: 'Plan' });
    const cancelled = askLinkTarget({} as unknown as InkHost, '');
    const second = await screen.findByRole('dialog', { name: 'Make link' });
    await userEvent.click(within(second).getByRole('button', { name: 'Cancel' }));
    expect(await cancelled).toBeNull();
  });
});
