// The title bar's save status tells the truth about pages too: a page whose save failed shows "Couldn't save"
// until the core saves it, however the tree's own commands fare.

import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pageSaveFailed, pageSaved } from '../../services/pages/saveHealth';
import { announcements, renderUi } from '../../test';
import { SaveStatus } from './SaveStatus';
import { treeStore } from './store';

afterEach(cleanup);

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
});
