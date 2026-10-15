// Shell QoL entry points (A2-29): the side-by-side conflict view, the cloud folder notice, and Settings > Storage.
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { navigate } from '../../app/location';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import { pressChord, renderApp } from '../../test';
import { openConflictDialog } from './ConflictDialog';

const PAGE = '01m3sa12426sg32pmtyffjaqcf';
const FIRST = { revision: '01m3sa12426sg32pmtyffjaqc9', device: { label: 'Laptop' }, savedAt: '2026-10-01T10:00:00Z' };

afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"]'); i += 1) await pressChord('Escape');
  resetFakeShell();
});

describe('the conflict view', () => {
  it('shows both versions side by side and keeps the one chosen', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    setFakeShell((name, args) => {
      calls.push([name, args]);
      if (name === 'conflict.text') return { mine: 'Mine says hello', theirs: 'Theirs says goodbye' };
      if (name === 'conflict.resolve') return { ok: true };
      return null;
    });
    await renderApp();
    const closed = openConflictDialog(PAGE, FIRST, 1);
    const dialog = await screen.findByRole('dialog', { name: 'Two versions of this page' });
    expect(await within(dialog).findByText('Mine says hello')).toBeTruthy();
    expect(within(dialog).getByText('Theirs says goodbye')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: /^From Laptop, saved/ })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep this version' }));
    await closed;
    expect(calls.find(([name]) => name === 'conflict.resolve')?.[1]).toEqual({
      pageId: PAGE,
      revision: FIRST.revision,
      choice: 'keepMine',
    });
    expect(screen.queryByRole('dialog', { name: 'Two versions of this page' })).toBeNull();
  });

  it('keeps the view open and says so when the choice fails', async () => {
    setFakeShell((name) => {
      if (name === 'conflict.text') return null;
      if (name === 'conflict.resolve') throw new Error('locked');
      return null;
    });
    await renderApp();
    void openConflictDialog(PAGE, FIRST, 1);
    const dialog = await screen.findByRole('dialog', { name: 'Two versions of this page' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep both' }));
    expect(screen.getByRole('dialog', { name: 'Two versions of this page' })).toBeTruthy();
  });
});

describe('Settings, then Storage', () => {
  it('explains a notes folder in OneDrive and keeps it on this device when asked', async () => {
    const calls: string[] = [];
    setFakeShell((name) => {
      calls.push(name);
      if (name === 'cloud.detect') return { service: 'oneDrive', name: 'OneDrive', canPin: true };
      if (name === 'cloud.keepOnDevice') return { ok: true };
      return null;
    });
    await renderApp({ settings: { storage: { notesFolder: 'C:\\Users\\Ada\\OneDrive\\Notes' } } });
    navigate({ view: 'settings', section: 'storage' });
    const heading = await screen.findByRole('heading', { name: 'This notes folder is in OneDrive' });
    const notice = heading.closest('section') as HTMLElement;
    await userEvent.click(within(notice).getByRole('button', { name: 'Always keep on this device' }));
    const kept = await within(notice).findByRole('button', { name: 'This folder stays on this device' });
    expect((kept as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toContain('cloud.keepOnDevice');
  });

  it('saves Rename folders with notebooks as the person sets it', async () => {
    const patches: unknown[] = [];
    setFakeShell((name, args) => {
      if (name === 'prefs.get') return { renameNotebookFolders: true };
      if (name === 'prefs.set') patches.push(args.patch);
      return null;
    });
    await renderApp({ settings: { storage: { notesFolder: 'D:\\Notes' } } });
    navigate({ view: 'settings', section: 'storage' });
    const toggle = await screen.findByRole('switch', { name: 'Rename folders with notebooks' });
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(toggle);
    expect(patches).toEqual([{ renameNotebookFolders: false }]);
  });
});
