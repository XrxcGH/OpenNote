// The command bar's group dividers (docs/BRAND.md section 11): a short centered line, not a full-height border.

import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defineCommand } from '../../commands/registry';
import { commandBar, commands } from '../../registries';
import { disposeApp, renderApp } from '../../test';

const bar = (name: string) => document.querySelector(`[role="toolbar"][aria-label="${name}"]`) as HTMLElement;

describe('the group dividers', () => {
  it('are a short line, 20 px tall (24 px with touch sizes), in place of a full-height border', async () => {
    const stops = [commandBar.replaceAll([])];
    for (const id of ['one', 'two']) {
      stops.push(
        commands.register(
          defineCommand({ id: `test.${id}`, title: 'commands.colors.ink', category: 'general', run() {} }),
        ),
      );
      stops.push(commandBar.register({ id, tab: 'home', group: id, command: `test.${id}`, priority: 50 }));
    }
    try {
      for (const [density, height] of [
        ['mouse', '20px'],
        ['touch', '24px'],
      ] as const) {
        await renderApp({ density });
        const slot = await waitFor(() => {
          const found = bar('Home').querySelector('[data-group-start]');
          expect(found).not.toBeNull();
          return found as HTMLElement;
        });
        expect(getComputedStyle(slot, '::before').height).toBe(height);
        expect(getComputedStyle(slot).borderInlineStartWidth).toBe('0px');
        expect(slot.getBoundingClientRect().height).toBeGreaterThan(parseFloat(height));
        disposeApp();
      }
    } finally {
      stops.forEach((stop) => stop());
    }
  });
});
