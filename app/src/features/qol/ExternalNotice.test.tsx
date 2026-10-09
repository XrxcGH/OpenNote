// Bringing in an edited page.md: the notice's "Bring in the text" button asks the shell to import it, reloads the
// page when the page changed, and only drops the notice when nothing changed or the import failed. A page that
// opens also asks the shell whether its page.md has edits. The shell is the web host's fake.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../app/flags';
import { navigate, onNavigate } from '../../app/location';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import type { NodeId } from '../../services/notes/types';
import { t } from '../../strings/t';
import { ExternalNotice } from './ExternalNotice';
import { externalStore, markReadable } from './externalStore';
import './flags';

const PAGE = 'p-readable' as NodeId;
let calls: string[];

function openPage(): void {
  act(() => navigate({ view: 'workspace', notebookId: null, sectionId: null, pageId: PAGE }));
}

function fakeShell(importAnswer: () => unknown, readable: unknown = null): void {
  setFakeShell((name) => {
    calls.push(name);
    if (name === 'external.importReadable') return importAnswer();
    if (name === 'external.readable') return readable;
    return null;
  });
}

describe('ExternalNotice bringing in an edited page.md', () => {
  beforeEach(() => {
    calls = [];
    initFlags('dev', { 'qol.externalEdits': true, 'qol.conflicts': false });
    externalStore.set({ changed: {}, tick: 0 });
    openPage();
  });
  afterEach(() => {
    cleanup();
    resetFakeShell();
    act(() => navigate({ view: 'trash' }));
  });

  it('reloads the page when the text was brought in', async () => {
    fakeShell(() => true);
    act(() => markReadable(PAGE));
    render(<ExternalNotice />);
    const pages: (NodeId | null)[] = [];
    const stop = onNavigate((navigation) => {
      if (navigation.to.view === 'workspace') pages.push(navigation.to.pageId);
    });
    fireEvent.click(await screen.findByRole('button', { name: t('qol.external.bringIn') }));
    await waitFor(() => expect(pages).toEqual([null, PAGE]));
    stop();
    expect(calls).toContain('external.importReadable');
    expect(externalStore.get().changed[PAGE]).toBeUndefined();
  });

  it.each([
    ['nothing changed', () => false],
    [
      'the import fails',
      () => {
        throw new Error('no');
      },
    ],
  ])('only drops the notice when %s', async (_name, answer) => {
    fakeShell(answer);
    act(() => markReadable(PAGE));
    render(<ExternalNotice />);
    const pages: unknown[] = [];
    const stop = onNavigate((navigation) => pages.push(navigation.to));
    fireEvent.click(await screen.findByRole('button', { name: t('qol.external.bringIn') }));
    await waitFor(() => expect(externalStore.get().changed[PAGE]).toBeUndefined());
    stop();
    expect(calls).toContain('external.importReadable');
    expect(pages).toEqual([]);
  });

  it('checks a page when it opens and offers the text if page.md was edited', async () => {
    fakeShell(() => false, { changed: true });
    render(<ExternalNotice />);
    await waitFor(() => expect(externalStore.get().changed[PAGE]).toBe('readable'), { timeout: 3000 });
    expect(calls).toContain('external.readable');
    expect(await screen.findByRole('button', { name: t('qol.external.bringIn') })).toBeTruthy();
  });
});
