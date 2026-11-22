// The panel tabs point at their panel only while it is shown (gap V2-8): a collapsed panel has no element.
import { cleanup, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { BottomPanel } from './BottomPanel';
import { StudioController } from './controller';
import { scratchSource } from './source';

function Harness({ controller }: { controller: StudioController }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <BottomPanel controller={controller} />;
}

let controller: StudioController | null = null;
afterEach(() => {
  cleanup();
  controller?.dispose();
});

describe('the bottom panel tabs', () => {
  it('names the panel in aria-controls only while it exists', async () => {
    controller = new StudioController();
    controller.open(scratchSource());
    render(<Harness controller={controller} />);
    const tab = screen.getByRole('tab', { name: 'Console' });
    const panel = screen.getByRole('tabpanel');
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);

    await userEvent.click(screen.getByRole('button', { name: 'Hide the panels' }));
    expect(screen.queryByRole('tabpanel')).toBeNull();
    for (const one of screen.getAllByRole('tab')) expect(one.hasAttribute('aria-controls')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Show the panels' }));
    expect(screen.getByRole('tab', { name: 'Console' }).getAttribute('aria-controls')).toBe(
      screen.getByRole('tabpanel').id,
    );
  });
});
