import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, type PageViewSpec } from '../layout';
import { shownPagesView, type PagesViewApi } from '../live/shown';
import { DRAFTING_IDS } from '../paper';
import { readDrawing, DRAWING_KEY } from '../paper';
import { applyDraftingPaper } from './draftingPaper';

function fake(): { api: PagesViewApi; now: () => PageViewSpec; notes: string[] } {
  let view: PageViewSpec = DEFAULT_VIEW;
  const notes: string[] = [];
  const api = {
    view: () => view,
    edit: (change: (v: PageViewSpec) => PageViewSpec, note?: string) => {
      view = change(view);
      if (note) notes.push(note);
    },
  } as unknown as PagesViewApi;
  return { api, now: () => view, notes };
}

afterEach(() => shownPagesView.set(null));

describe('engineering paper on the shown page', () => {
  it('does nothing and says so when no page is shown', () => {
    expect(applyDraftingPaper('computation')).toBe(false);
  });

  it('puts each paper on the page as a template, with its drawing kept beside it', () => {
    for (const key of ['computation', 'threeView', 'titleBlock'] as const) {
      const f = fake();
      shownPagesView.set(f.api);
      expect(applyDraftingPaper(key)).toBe(true);
      const background = f.now().background;
      expect(background.pattern).toBe('template');
      expect(background.template).toBe(DRAFTING_IDS[key]);
      expect(readDrawing(background.extra[DRAWING_KEY])?.elements.length).toBeGreaterThan(0);
      expect(f.notes).toHaveLength(1);
    }
  });

  it('computation paper is a grid of five squares to the inch', () => {
    const f = fake();
    shownPagesView.set(f.api);
    applyDraftingPaper('computation');
    const grid = readDrawing(f.now().background.extra[DRAWING_KEY])?.elements.find((e) => e.kind === 'grid');
    expect(grid).toMatchObject({ kind: 'grid', spacing: 96 / 5 });
  });
});
