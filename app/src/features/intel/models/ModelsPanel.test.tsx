// The Models panel is the one place for large downloads: the code studio's runtime packs sit in its Code group.
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { installTestHost } from '../testing';
import ModelsPanel, { stateLine } from './ModelsPanel';
import type { ModelInfo } from '../../../services/intel';

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

describe('the state of a model that is almost downloaded', () => {
  it('says what is left, not "77.7 MB of 77.7 MB" (VB-190)', () => {
    const size = 77_700_400;
    const model = { state: 'partial', sizeBytes: size, bytes: size - 400 } as ModelInfo;
    expect(stateLine(model)).toBe('1 KB left to download. You can resume.');
    expect(stateLine({ ...model, bytes: 30_000_000 })).toBe('30 MB of 77.7 MB downloaded. You can resume.');
  });
});
