import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../test';
import { Wizard } from './Wizard';

const folderCheck = (kind: string) =>
  (window.__OPENNOTE_TEST__ as Record<string, (arg: unknown) => unknown>).folderCheck({ kind });

afterEach(() => {
  cleanup();
  folderCheck('willCreate');
});

describe('the sync setup steps', () => {
  it('stays on the first step and says so when the folder cannot take files', async () => {
    await renderApp();
    folderCheck('notWritable');
    render(<Wizard mode="create" onDone={() => {}} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Folder', { exact: true }), String.raw`Z:\Nowhere`);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/can’t save files in that folder/)).toBeTruthy();
    expect(screen.queryByLabelText('Passphrase', { exact: false })).toBeNull();
  });

  it('goes on to the passphrase when the folder can take files', async () => {
    await renderApp();
    render(<Wizard mode="create" onDone={() => {}} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Folder', { exact: true }), String.raw`C:\Users\Sam\OneDrive\Sync`);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect((await screen.findAllByLabelText(/passphrase/i)).length).toBeGreaterThan(0);
  });
});
