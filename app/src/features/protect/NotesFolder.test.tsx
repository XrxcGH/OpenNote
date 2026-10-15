// Settings, then Storage: changing the notes folder (A4-5) and "Rename folders with notebooks" (A4-4).
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { navigate } from '../../app/location';
import { emitFakeShellEvent, resetFakeShell, setFakeShell } from '../../platform/shellqol';
import { settingsStore } from '../../state/settings';
import { expectFocus, pressChord, renderApp } from '../../test';
import { comparable, refusal } from './NotesFolder';

const OLD = 'C:\\Users\\Ada\\Documents\\OpenNote';
const NEXT = 'D:\\Notes';

async function openStorage() {
  const app = await renderApp({ settings: { storage: { notesFolder: OLD } } });
  navigate({ view: 'settings', section: 'storage' });
  await screen.findByRole('heading', { name: 'Notes folder' });
  vi.spyOn(app.platform.install, 'pickNotesFolder').mockResolvedValue(NEXT);
  return app;
}

afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('[role="dialog"]'); i += 1) await pressChord('Escape');
  resetFakeShell();
});

describe('the notes folder', () => {
  it('refuses a folder inside the notes folder or one OpenNote cannot use', () => {
    expect(comparable('C:/Notes/')).toBe('c:\\notes');
    expect(refusal(OLD, `${OLD}\\Inner`, { kind: 'ok' })).toMatch(/outside your notes folder/);
    expect(refusal(OLD, 'C:\\Users\\Ada', { kind: 'ok' })).toMatch(/outside your notes folder/);
    expect(refusal(OLD, OLD.toUpperCase(), { kind: 'ok' })).toBe('That is already your notes folder.');
    expect(refusal(OLD, NEXT, { kind: 'notWritable' })).toMatch(/can't save/);
    expect(refusal(OLD, NEXT, { kind: 'hasLibrary', notebookCount: 2 })).toBeNull();
  });

  it('moves the notebooks with progress, then changes the setting', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    setFakeShell((name, args) => {
      calls.push([name, args]);
      if (name === 'storage.moveNotes') {
        setTimeout(() => {
          emitFakeShellEvent({ kind: 'notesMove', notebook: 1, notebooks: 2, done: 3, total: 10 });
        }, 20);
        return { ok: true };
      }
      return null;
    });
    const app = await openStorage();
    vi.spyOn(app.platform.install, 'checkNotesFolder').mockResolvedValue({ kind: 'ok' });
    await userEvent.click(screen.getByRole('button', { name: 'Change notes folder' }));
    const dialog = await screen.findByRole('dialog', { name: `Use ${NEXT} for your notes?` });
    await expectFocus(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move my notebooks' }));
    expect(calls.find(([name]) => name === 'storage.moveNotes')?.[1]).toEqual({ to: NEXT });
    expect(await screen.findByText('Moving notebook 1 of 2…')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '3 of 10 files copied and checked' })).toBeTruthy();
    expect(settingsStore.get().settings.storage.notesFolder).toBe(OLD);
    emitFakeShellEvent({ kind: 'notesMoveDone', ok: true, moved: 2, failed: 0, cancelled: false });
    await expect.poll(() => settingsStore.get().settings.storage.notesFolder).toBe(NEXT);
    expect(await screen.findByText(`Your notebooks are in ${NEXT}.`)).toBeTruthy();
  });

  it('keeps the setting when the move is stopped', async () => {
    setFakeShell((name) => (name === 'storage.moveNotes' ? { ok: true } : null));
    const app = await openStorage();
    vi.spyOn(app.platform.install, 'checkNotesFolder').mockResolvedValue({ kind: 'ok' });
    await userEvent.click(screen.getByRole('button', { name: 'Change notes folder' }));
    const dialog = await screen.findByRole('dialog', { name: `Use ${NEXT} for your notes?` });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move my notebooks' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop moving' }));
    emitFakeShellEvent({ kind: 'notesMoveDone', ok: false, moved: 1, failed: 0, cancelled: true });
    expect(await screen.findByText(/^Stopped\./)).toBeTruthy();
    expect(settingsStore.get().settings.storage.notesFolder).toBe(OLD);
  });

  it('uses the notebooks already in a folder without moving any', async () => {
    const calls: string[] = [];
    setFakeShell((name) => {
      calls.push(name);
      return null;
    });
    const app = await openStorage();
    vi.spyOn(app.platform.install, 'checkNotesFolder').mockResolvedValue({ kind: 'hasLibrary', notebookCount: 3 });
    await userEvent.click(screen.getByRole('button', { name: 'Change notes folder' }));
    const dialog = await screen.findByRole('dialog', { name: `Use ${NEXT} for your notes?` });
    expect(dialog.textContent).toContain('It already has 3 notebooks.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use the notebooks there' }));
    await expect.poll(() => settingsStore.get().settings.storage.notesFolder).toBe(NEXT);
    expect(calls).not.toContain('storage.moveNotes');
  });

  it('keeps "Rename folders with notebooks" in the shell choices', async () => {
    const patches: unknown[] = [];
    setFakeShell((name, args) => {
      if (name === 'prefs.get') return {};
      if (name === 'prefs.set') patches.push(args.patch);
      return null;
    });
    await openStorage();
    const toggle = await screen.findByRole('switch', { name: 'Rename folders with notebooks' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(toggle);
    expect(patches).toEqual([{ renameNotebookFolders: false }]);
  });
});
