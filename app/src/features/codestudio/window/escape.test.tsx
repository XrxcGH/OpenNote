// Escape in the studio's code editor (review gap G6) arms "Tab leaves the editor" and keeps the studio open. The
// documented way out of the editor is Escape, then Tab (DESIGN 5.3.1). Escape outside the editor still closes it.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../../app/flags';
import { renderApp } from '../../../test';
import { closeTool, openTool, openTools } from '../../tools';

afterEach(() => {
  closeTool('code');
  initFlags('dev');
});

describe('Escape in the code studio', () => {
  it('keeps the studio open from the editor, then Tab moves focus out of the editor', async () => {
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
    await waitFor(() => expect(content.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(openTools()).toContain('code');
    await userEvent.keyboard('{Tab}');
    await waitFor(() => expect(content.contains(document.activeElement)).toBe(false));
    expect(openTools()).toContain('code');

    // From a control outside the editor, Escape closes the window as every tool window does.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(openTools()).not.toContain('code'));
  });
});
