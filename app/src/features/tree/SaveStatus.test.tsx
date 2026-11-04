// The title bar's save status tells the truth about pages too: a page whose save failed shows "Couldn't save"
// until the core saves it, however the tree's own commands fare.

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pageSaveFailed,
  pageSaved,
  saveHealthStore,
  setCoreStalled,
  setSaveRecovery,
} from '../../services/pages/saveHealth';
import { announcements, renderUi } from '../../test';
import { SaveStatus } from './SaveStatus';
import { treeStore } from './store';

afterEach(() => {
  cleanup();
  setSaveRecovery(null);
  saveHealthStore.set((state) => ({ ...state, failing: new Set(), failures: new Map() }));
});

/** A page view that holds `p1`, as the shown page does. */
function recovery(retry: () => Promise<boolean>, text = 'My notes') {
  const copy = vi.fn(async (): Promise<string | null> => text);
  setSaveRecovery({ holds: (page) => page === 'p1', retry, text: copy });
  return copy;
}

describe('the save status', () => {
  it('shows a failed page save and says so, then Saved again once the page saves', () => {
    renderUi(<SaveStatus presentation="full" />);
    expect(screen.getByText('Saved')).toBeTruthy();
    act(() => pageSaveFailed('p1'));
    expect(screen.getByText("Couldn't save")).toBeTruthy();
    expect(announcements()).toContain("Couldn't save your notes. OpenNote keeps the changes and tries again.");
    act(() => treeStore.set((state) => ({ ...state, saveStatus: 'saving' })));
    expect(screen.getByText('Saving')).toBeTruthy();
    act(() => treeStore.set((state) => ({ ...state, saveStatus: 'saved' })));
    expect(screen.getByText("Couldn't save")).toBeTruthy();
    act(() => pageSaved('p1'));
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('says the core is not responding while a command holds it, whatever the tree says', () => {
    renderUi(<SaveStatus presentation="full" />);
    act(() => treeStore.set((state) => ({ ...state, saveStatus: 'saving' })));
    act(() => setCoreStalled(true));
    expect(screen.getByText('Not responding')).toBeTruthy();
    expect(announcements().some((said) => said.startsWith("OpenNote's core isn't responding"))).toBe(true);
    act(() => setCoreStalled(false));
    expect(screen.getByText('Saving')).toBeTruthy();
  });

  it('opens a notice with the reason from the chip, and Retry saves the page now', async () => {
    const retry = vi.fn(async () => true);
    recovery(retry);
    renderUi(<SaveStatus presentation="full" />);
    expect(screen.queryByRole('button', { name: "Couldn't save" })).toBeNull();
    act(() => pageSaveFailed('p1', { kind: 'diskFull', retrying: true }));
    fireEvent.click(screen.getByRole('button', { name: "Couldn't save" }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('The disk is full.');
    expect(dialog.textContent).toContain('OpenNote tries again on its own.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('p1'));
    act(() => pageSaved('p1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('says so when Retry fails again, and keeps the notice open', async () => {
    recovery(async () => Promise.reject(new Error('disk')));
    renderUi(<SaveStatus presentation="icon" />);
    act(() => pageSaveFailed('p1', { kind: 'readOnlyFile', retrying: false }));
    fireEvent.click(screen.getByRole('button', { name: "Couldn't save" }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('dialog').textContent).toContain("can't try again on its own");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain("Still couldn't save."));
    expect(screen.getByRole('status').textContent).toContain('marked read-only');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('offers Copy text where the page cannot be saved, and copies the shown page', async () => {
    const copy = recovery(async () => true, 'Dear diary');
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    renderUi(<SaveStatus presentation="full" />);
    act(() => pageSaveFailed('p1', { kind: 'busy', retrying: true }));
    fireEvent.click(screen.getByRole('button', { name: "Couldn't save" }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Copy text' })).toBeNull();
    act(() => pageSaveFailed('p1', { kind: 'blocked', retrying: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy text' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith('Dear diary'));
    expect(copy).toHaveBeenCalledWith('p1');
  });
});
