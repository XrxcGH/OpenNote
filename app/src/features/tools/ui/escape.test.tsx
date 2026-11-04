// Escape closes a floating tool window and gives focus back to where it was (Beta 8 visual recheck: Escape did not
// close the Flashcards window).
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test';
import { closeTool, openTool, openTools } from './host';
import { TOOLS } from './tools';

afterEach(() => {
  for (const tool of TOOLS) closeTool(tool.id);
});

describe('a tool window and Escape', () => {
  it('closes with Escape, focus on the page or in the window, and returns focus to the opener', async () => {
    await renderApp();
    const opener = document.body.appendChild(document.createElement('button'));
    opener.textContent = 'Opener';
    opener.focus();
    openTool('flashcards');
    const window_ = await screen.findByRole('dialog', { name: /Flashcards/ });
    await waitFor(() => expect(window_.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(openTools()).not.toContain('flashcards'));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('closes with Escape from a control inside the tool, not only from its title', async () => {
    await renderApp();
    openTool('flashcards');
    const window_ = await screen.findByRole('dialog', { name: /Flashcards/ });
    await waitFor(() => expect(window_.contains(document.activeElement)).toBe(true));
    const control = window_.querySelector<HTMLElement>('[data-loading] input, [data-loading] select, [data-loading] button');
    expect(control, 'the tool has a control').not.toBeNull();
    control!.focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(openTools()).not.toContain('flashcards'));
  });
});
