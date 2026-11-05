import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { navigate } from '../../app/location';
import { NotesProvider } from '../../services/notes';
import type { FixtureData } from '../../services/notes/fixtures';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { ChipColor, NodeId } from '../../services/notes/types';
import { useNotebookAccent } from './useNotebookAccent';

const when = '2026-09-01T09:00:00.000Z';
const fixture: FixtureData = {
  folder: 'Notes',
  notebooks: [
    {
      id: 'n-plum',
      kind: 'notebook',
      title: 'Plum book',
      color: 'plum',
      created: when,
      modified: when,
      children: [
        {
          id: 's-amber',
          kind: 'section',
          title: 'Amber section',
          color: 'amber',
          created: when,
          modified: when,
          children: [{ id: 'p-one', kind: 'page', title: 'One', pageLevel: 0, created: when, modified: when }],
        },
      ],
    },
    {
      id: 'n-plain',
      kind: 'notebook',
      title: 'Plain book',
      color: null,
      created: when,
      modified: when,
      children: [
        {
          id: 's-fern',
          kind: 'section',
          title: 'Fern section',
          color: 'fern',
          created: when,
          modified: when,
          children: [{ id: 'p-two', kind: 'page', title: 'Two', pageLevel: 0, created: when, modified: when }],
        },
      ],
    },
  ] as unknown as FixtureData['notebooks'],
};

function Probe() {
  const accent: ChipColor | null = useNotebookAccent();
  return <output data-testid="accent">{accent ?? 'none'}</output>;
}

function show(notebookId: string, sectionId: string, pageId: string) {
  act(() =>
    navigate({
      view: 'workspace',
      notebookId: notebookId as NodeId,
      sectionId: sectionId as NodeId,
      pageId: pageId as NodeId,
    }),
  );
}

describe('useNotebookAccent', () => {
  const notes = createMemoryNotesService({ seed: fixture });
  const mount = () =>
    render(
      <NotesProvider service={notes}>
        <Probe />
      </NotesProvider>,
    );

  it('gives the notebook color, not the section color', async () => {
    mount();
    show('n-plum', 's-amber', 'p-one');
    await expect.poll(() => screen.getByTestId('accent').textContent).toBe('plum');
  });

  it('gives null for an uncolored notebook, even with a colored section', async () => {
    mount();
    show('n-plain', 's-fern', 'p-two');
    await expect.poll(() => screen.getByTestId('accent').textContent).toBe('none');
  });

  it('gives null outside the workspace', async () => {
    mount();
    act(() => navigate({ view: 'settings', section: 'general' }));
    await expect.poll(() => screen.getByTestId('accent').textContent).toBe('none');
  });
});
