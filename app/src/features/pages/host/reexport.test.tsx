// The "Replaced, Undo" notice and the memory of where a page's PDF went.
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWebExports } from '../../../platform/web/exports';
import { renderUi } from '../../../test';
import { Toaster } from '../../../ui/toast';
import { lastExportPath, rememberExport, showReplaced } from './reexport';

describe('re-export memory', () => {
  it('remembers the last path for a page', () => {
    expect(lastExportPath('page-a')).toBeNull();
    rememberExport('page-a', 'C:/Docs/A.pdf');
    rememberExport('page-a', 'C:/Docs/B.pdf');
    expect(lastExportPath('page-a')).toBe('C:/Docs/B.pdf');
    expect(lastExportPath('page-b')).toBeNull();
  });
});

describe('the Replaced notice', () => {
  it('offers Undo, which puts the old file back', async () => {
    const client = { ...createWebExports(), undoReplace: vi.fn().mockResolvedValue(undefined) };
    renderUi(<Toaster />);
    act(() => showReplaced(client, 'C:/Docs/A.pdf', { kept: 'recycled' }));
    expect(screen.getByText('Replaced A.pdf.')).toBeTruthy();
    await act(async () => screen.getByRole('button', { name: 'Undo' }).click());
    expect(client.undoReplace).toHaveBeenCalledWith('C:/Docs/A.pdf');
    expect(await screen.findByText('Put A.pdf back.')).toBeTruthy();
  });

  it('says where the old file is kept when the Recycle Bin could not take it', () => {
    const client = createWebExports();
    renderUi(<Toaster />);
    act(() => showReplaced(client, 'Z:/A.pdf', { kept: 'beside', keptAs: 'A (replaced).pdf' }));
    expect(screen.getByText(/kept beside it as A \(replaced\)\.pdf/)).toBeTruthy();
  });

  it('has no Undo when nothing was replaced', () => {
    renderUi(<Toaster />);
    act(() => showReplaced(createWebExports(), 'C:/Docs/New.pdf', { kept: 'nothing' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});
