// The properties fields in touch density: the type list is 44 px and stands 8 px from Add (Beta 8 walk VA-24, VA-28).
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { OpenPage } from '../../../services/pages/types';
import { renderUi } from '../../../test/render';
import { PropertiesBar } from './PropertiesBar';

afterEach(() => delete document.documentElement.dataset.density);

describe('the properties fields in touch density', () => {
  it('gives the properties type list 44 px and a space of 8 px from Add', async () => {
    const stub = {
      initial: { view: {} },
      onFrame: () => () => undefined,
      send: () => Promise.resolve(),
    } as unknown as OpenPage;
    renderUi(<PropertiesBar page={stub} />, { density: 'touch' });
    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-expanded]')!);
    const type = screen.getByRole('combobox', { name: 'Type of field' });
    const add = within(type.closest('div') as HTMLElement).getByRole('button');
    expect(type.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const a = type.getBoundingClientRect();
    const b = add.getBoundingClientRect();
    expect(b.left - a.right).toBeGreaterThanOrEqual(8);
  });
});
