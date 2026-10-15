// The live collection block in a real browser: it lists the pages its rules choose, follows the index when notes
// change, and lets the view change.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { PageFact, SearchClient } from '../../../services/search/types';
import { setSearchClient } from '../../search';
import { emptyCollection } from '../engine';
import { CollectionBlock } from './CollectionBlock';
import { readDef } from './def';

afterEach(() => {
  cleanup();
  setSearchClient(null);
});

const fact = (page: string, title: string, tags: string[]): PageFact =>
  ({ page, title, notebook: 'n', section: 's', created: 1, modified: 1, tags, properties: undefined }) as never;

function fakeClient(initial: PageFact[]) {
  let facts = initial;
  const listeners = new Set<() => void>();
  const client = {
    extras: { pageFacts: async () => facts },
    onUpdate: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    search: async () => ({ hits: [] }),
  } as unknown as SearchClient;
  return {
    client,
    change(next: PageFact[]) {
      facts = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('CollectionBlock', () => {
  it('lists the pages a tag picks and follows the notes as they change', async () => {
    const fake = fakeClient([fact('a', 'Mitosis', ['bio']), fact('b', 'Rome', ['history'])]);
    setSearchClient(fake.client);
    const def = { ...emptyCollection('c', 'Biology'), tag: 'bio', view: 'list' as const };
    render(<CollectionBlock def={def} readOnly={false} onChange={vi.fn()} open={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Mitosis' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rome' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Collection: Biology' })).toBeTruthy();
    act(() => fake.change([fact('a', 'Mitosis', ['bio']), fact('c', 'Cell walls', ['bio'])]));
    expect(await screen.findByRole('button', { name: 'Cell walls' }, { timeout: 3000 })).toBeTruthy();
  });

  it('opens a page and changes the view', async () => {
    const fake = fakeClient([fact('a', 'Mitosis', ['bio'])]);
    setSearchClient(fake.client);
    const open = vi.fn();
    const onChange = vi.fn();
    const def = { ...emptyCollection('c', 'Biology'), view: 'list' as const };
    render(<CollectionBlock def={def} readOnly={false} onChange={onChange} open={open} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mitosis' }));
    expect(open).toHaveBeenCalledWith('a');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'View' }), 'table');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ view: 'table' })));
  });

  it('shows no view menu when the page is read only', async () => {
    setSearchClient(fakeClient([]).client);
    render(<CollectionBlock def={emptyCollection('c', 'Empty')} readOnly onChange={vi.fn()} open={vi.fn()} />);
    expect(await screen.findByText('No page matches these rules.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'View' })).toBeNull();
  });
});

describe('readDef', () => {
  it('reads the rules a block carries, with every field checked', () => {
    const def = readDef({ def: { id: 'x', name: 'N', tag: 'bio', view: 'sideways', conditions: [{ name: 1 }, null] } }, []);
    expect(def).toMatchObject({ id: 'x', name: 'N', tag: 'bio', view: 'list', conditions: [], sortDir: 'asc' });
  });

  it('falls back to a saved collection the block names, then to an empty one', () => {
    const saved = [{ ...emptyCollection('s1', 'Saved'), tag: 'x' }];
    expect(readDef({ collection: 's1' }, saved).tag).toBe('x');
    expect(readDef({}, saved).name).toBe('');
  });
});
