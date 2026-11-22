// The Models panel is the one place for large downloads: the code studio's runtime packs sit in its Code group.
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { installTestHost } from '../testing';
import ModelsPanel from './ModelsPanel';

beforeEach(() => {
  installTestHost();
});

describe('the Models panel', () => {
  it('has a Code group for the code studio downloads', async () => {
    renderUi(<ModelsPanel />);
    const group = await screen.findByRole('list', { name: 'Code' });
    expect(group.closest('#code-downloads')).toBeTruthy();
    // In a browser there is no shell, so the group says where downloads work.
    // The note comes after the shell check fails, which can land after the list is drawn.
    expect(await within(group.parentElement!).findByText('Code downloads work in the desktop app.')).toBeTruthy();
  });
});
