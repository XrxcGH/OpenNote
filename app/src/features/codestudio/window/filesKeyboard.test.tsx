// The file tree and the tab strip by keyboard alone (review gap G4). Each file's actions and each tab's Close button
// take focus. On a file, Shift+F10 or the menu key opens its actions, F2 renames, and Delete deletes. On a tab,
// Ctrl+F4 closes it.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { StudioController } from './controller';
import { FileTree, TabStrip } from './Files';
import { scratchSource } from './source';

function Both({ controller }: { controller: StudioController }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  return (
    <>
      <FileTree controller={controller} />
      <TabStrip controller={controller} withFilesMenu={false} />
    </>
  );
}

function setup() {
  try {
    localStorage.removeItem('opennote.codestudio.scratch');
  } catch {
    // A fresh scratch project either way.
  }
  const controller = new StudioController();
  controller.open(scratchSource());
  controller.newFile('extra.py');
  const extra = controller.fileIds().find((id) => controller.pathOf(id) === 'extra.py')!;
  controller.openFile(extra);
  render(<Both controller={controller} />);
  return { controller, extra };
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('[role="menu"]').forEach((menu) => menu.closest('[role="region"]')?.remove());
});

describe('files and tabs by keyboard', () => {
  it('lets Tab reach every file action button and every tab Close button', () => {
    setup();
    const actions = screen.getAllByRole('button', { name: /^Actions for / });
    const closes = screen.getAllByRole('button', { name: /^Close / });
    expect(actions.length).toBe(2);
    expect(closes.length).toBeGreaterThan(0);
    for (const button of [...actions, ...closes]) expect(button.tabIndex).toBeGreaterThanOrEqual(0);
  });

  it('opens the actions with Shift+F10, renames with F2, and deletes with Delete', async () => {
    const { controller, extra } = setup();
    const row = () => screen.getAllByRole('button', { name: /extra\.py/ }).find((b) => b.closest('nav'))!;
    row().focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    expect(((await screen.findByRole('textbox')) as HTMLInputElement).value).toBe('extra.py');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());

    row().focus();
    await userEvent.keyboard('{F2}');
    const field = await screen.findByRole('textbox');
    expect((field as HTMLInputElement).value).toBe('extra.py');
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(row()).toBeTruthy());
    row().focus();
    await userEvent.keyboard('{Delete}');
    // A scratch project has no page undo: the studio asks first, and Cancel keeps the file.
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(controller.fileIds()).toContain(extra);

    await waitFor(() => expect(row()).toBeTruthy());
    row().focus();
    await userEvent.keyboard('{Delete}');
    const dialog = await screen.findByRole('dialog', { name: 'Delete extra.py?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(controller.fileIds()).not.toContain(extra));
  });

  it('closes a tab with Ctrl+F4', async () => {
    const { controller, extra } = setup();
    expect(controller.tabs).toContain(extra);
    const tab = screen.getAllByRole('button', { name: /extra\.py/ }).find((b) => !b.closest('nav'))!;
    tab.focus();
    await userEvent.keyboard('{Control>}{F4}{/Control}');
    await waitFor(() => expect(controller.tabs).not.toContain(extra));
  });
});
