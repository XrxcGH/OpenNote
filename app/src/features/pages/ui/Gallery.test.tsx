// The gallery's thumbnails of pages that hold pictures. The page is closed once its thumbnail is drawn, and a closed
// page serves no asset, so the thumbnail must carry its pictures itself.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestPlatform } from '../../../test';
import { createMemoryNotesService } from '../../../services/notes/memory';
import type { NodeId } from '../../../services/notes';
import type { OpenPage } from '../../../services/pages/types';
import { Gallery } from './Gallery';

afterEach(cleanup);

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** A page with one picture, whose asset URL stops working once the page closes, as the core's does. */
function pageWithPicture(id: string): OpenPage {
  const url = URL.createObjectURL(new Blob([PNG.slice()], { type: 'image/png' }));
  return {
    id,
    client: 'test',
    initial: {
      id,
      title: 'With a picture',
      created: '2026-10-01T10:00:00.000Z',
      modified: '2026-10-01T10:00:00.000Z',
      tags: [],
      assets: { A1: { file: 'A1.png', mime: 'image/png', name: 'Dot.png', width: 1, height: 1 } },
      view: { layout: 'flow', mode: 'paginated' },
      blocks: [{ id: 'i1', type: 'image', order: 'a00000', data: { asset: 'A1', alt: 'A dot' } }],
    },
    assetUrl: () => url,
    close: () => {
      URL.revokeObjectURL(url);
      return Promise.resolve();
    },
  } as unknown as OpenPage;
}

async function sectionWithPages(notes: ReturnType<typeof createMemoryNotesService>) {
  const [notebook] = await notes.listNotebooks();
  for (const section of await notes.listChildren(notebook.id)) {
    if ((await notes.listChildren(section.id)).some((child) => child.kind === 'page')) return { notebook, section };
  }
  throw new Error('The sample library has no section with pages.');
}

describe('Gallery thumbnails with pictures', () => {
  it('draws the picture from its bytes, read while the page is open', async () => {
    const notes = createMemoryNotesService({ seed: 'sample' });
    const { notebook, section } = await sectionWithPages(notes);
    const base = createTestPlatform();
    const open = vi.fn(async (id: string) => pageWithPicture(id));
    const platform = { ...base, pages: { ...base.pages, open } } as typeof base;
    render(
      <Gallery
        notes={notes}
        platform={platform}
        notebookId={notebook.id as NodeId}
        sectionId={section.id as NodeId}
        navigate={vi.fn()}
        close={vi.fn()}
      />,
    );
    await screen.findAllByRole('option');
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    const doc = document.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
    expect(doc).toContain('src="data:image/png;base64,');
    expect(doc).not.toContain('blob:');
    expect(doc).not.toContain('Image without a description');
    expect(open).toHaveBeenCalled();
  });
});
