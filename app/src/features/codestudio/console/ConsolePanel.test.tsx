// A full console stays out of the typing path (review gap G5). The log holds 5,000 lines. A change of the studio's
// state, a keystroke, or a caret move searches no line for links again. One new line searches only that line.
import { act, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderUi } from '../../../test';
import { StudioController } from '../window/controller';
import { scratchSource } from '../window/source';
import { MAX_LINES } from './buffer';
import { ConsolePanel } from './ConsolePanel';
import { findLinks } from './links';

vi.mock('./links', { spy: true });

/** The panel as the studio window draws it: redrawn on every change of the controller. */
function Harness({ controller }: { controller: StudioController }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <ConsolePanel controller={controller} />;
}

let controller: StudioController | null = null;
afterEach(() => controller?.dispose());

describe('the console with a full log', () => {
  it('searches no line again when the studio redraws, and only the new line when output arrives', async () => {
    controller = new StudioController();
    controller.mount();
    controller.open(scratchSource());
    const studio = controller;
    act(() => studio.console.write('out', Array.from({ length: MAX_LINES }, (_, at) => `line ${at}\n`).join('')));
    renderUi(<Harness controller={studio} />);
    expect(await screen.findByText(`line ${MAX_LINES - 1}`)).toBeTruthy();
    const search = vi.mocked(findLinks);
    search.mockClear();

    const id = studio.project()!.main;
    act(() => {
      studio.edited(id, 'x = 1');
      studio.setCursor({ line: 1, column: 6 });
      studio.edited(id, 'x = 12');
      studio.showPanel('console');
    });
    expect(search).not.toHaveBeenCalled();

    act(() => studio.console.write('out', 'one more\n'));
    expect(await screen.findByText('one more')).toBeTruthy();
    // Only the new line is searched: dropping the oldest line redraws no other line.
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('keeps the lines out of the per-frame visibility checks (gap V2-1)', async () => {
    controller = new StudioController();
    controller.mount();
    controller.open(scratchSource());
    const studio = controller;
    act(() => studio.console.write('out', Array.from({ length: 50 }, (_, at) => `row ${at}\n`).join('')));
    renderUi(<Harness controller={studio} />);
    const line = (await screen.findByText('row 49')).closest('[data-kind]')!;
    // `content-visibility: auto` on 5,000 lines doubled the editor's time per key in the built app.
    expect(getComputedStyle(line).contentVisibility).not.toBe('auto');
    // The log alone holds the lines' layout.
    expect(getComputedStyle(screen.getByRole('log')).contain).toBe('strict');
  });

  it('marks standard error by more than color: a border at the line start and a label (gap V2-8)', async () => {
    controller = new StudioController();
    controller.mount();
    controller.open(scratchSource());
    const studio = controller;
    act(() => {
      studio.console.write('out', 'fine\n');
      studio.console.write('err', 'broken\n');
    });
    renderUi(<Harness controller={studio} />);
    const err = (await screen.findByText('broken')).closest('[data-kind]') as HTMLElement;
    const out = screen.getByText('fine').closest('[data-kind]') as HTMLElement;
    expect(getComputedStyle(err).borderInlineStartStyle).toBe('solid');
    expect(getComputedStyle(out).borderInlineStartStyle).toBe('none');
    expect(err.textContent).toBe('Error output: broken');
    expect(out.textContent).toBe('fine');
  });
});
