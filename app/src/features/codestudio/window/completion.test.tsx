// The studio's editor offers the completion list (T4-D09-7): Ctrl+Space opens it for JavaScript.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../../app/flags';
import { renderApp } from '../../../test';
import { closeTool, openTool } from '../../tools';

afterEach(() => {
  closeTool('code');
  initFlags('dev');
});

describe('completion in the code studio', () => {
  it('opens the list on Ctrl+Space after a word start', async () => {
    initFlags('dev', { 'code.studio': true });
    await renderApp();
    openTool('code');
    const studio = await screen.findByTestId('code-studio', {}, { timeout: 15_000 });
    const content = await waitFor(
      () => {
        const found = studio.querySelector<HTMLElement>('.cm-content');
        expect(found).not.toBeNull();
        return found!;
      },
      { timeout: 15_000 },
    );
    content.focus();
    await userEvent.keyboard('const total = 1;{Enter}tot');
    await userEvent.keyboard('{Control>} {/Control}');
    await waitFor(() => expect(document.querySelector('.cm-tooltip-autocomplete')).not.toBeNull(), { timeout: 5000 });
  });
});
