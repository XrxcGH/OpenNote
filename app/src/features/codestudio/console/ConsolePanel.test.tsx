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
});
