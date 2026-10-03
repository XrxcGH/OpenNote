// The link popover takes the keys typed while it loaded (found by WP8's walk of the app): typing an address
// straight after Ctrl+K put its first letter into the text, over the selected words.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../registrations/editor';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { openLinkPopover } from './LinkPopover';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

describe('the link popover', () => {
  it('starts its address with the keys typed while it opened, and leaves the text alone', async () => {
    mounted = mountEditor('Visit [site]');
    const closed = openLinkPopover(mounted.editor, () => 'exa');
    const dialog = await screen.findByRole('dialog', { name: 'Link' });
    const field = dialog.querySelector('input')!;
    await expect.poll(() => field.value).toBe('exa');
    expect(document.activeElement).toBe(field);
    expect(mounted.markdown()).toBe('Visit site');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await closed;
  });
});
