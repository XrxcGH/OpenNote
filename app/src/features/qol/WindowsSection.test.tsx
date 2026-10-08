import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../app/flags';
import { chord, defineCommand } from '../../commands/registry';
import { resetFakeShell, setFakeShell } from '../../platform/shellqol';
import { commands } from '../../registries';
import { renderUi } from '../../test';
import { quickKeyProblem } from './quickCaptureControls';
import WindowsSection from './WindowsSection';

const stops: (() => void)[] = [];

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetFakeShell();
});

/** The shell as src-tauri/src/shellqol/quick.rs answers: it refuses an unusable key only for a choice that is on. */
function fakeQuickShell(start: { enabled: boolean; key: string }) {
  const saved = { ...start };
  const sets: { enabled: boolean; key: string }[] = [];
  setFakeShell((name, args) => {
    if (name === 'quick.status') return { choice: { ...saved }, registered: false };
    if (name === 'quick.set') {
      const next = { enabled: args.enabled as boolean, key: args.key as string };
      sets.push(next);
      if (quickKeyProblem(next.key)) {
        if (next.enabled) throw new Error('key: refused');
        next.key = 'Win+Shift+Q';
      }
      Object.assign(saved, next);
      return { choice: { ...saved }, registered: false };
    }
    return null;
  });
  return { saved, sets };
}

function renderSection() {
  initFlags('dev', { 'qol.quickCapture': true });
  renderUi(
    <main>
      <WindowsSection />
    </main>,
  );
}

describe('the quick capture settings', () => {
  it('turns off a Ctrl+Alt+Q choice an earlier beta saved without asking for new keys first', async () => {
    const shell = fakeQuickShell({ enabled: true, key: 'Ctrl+Alt+Q' });
    renderSection();
    const toggle = await screen.findByRole('switch', { name: 'Turn on the quick capture shortcut' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(shell.sets.at(-1)?.enabled).toBe(false);
    expect(shell.saved.enabled).toBe(false);
    // The refused key isn't kept: the field shows the default the shell saved in its place.
    const field = screen.getByRole('textbox', { name: 'Shortcut' }) as HTMLInputElement;
    expect(field.value).toBe('Win+Shift+Q');
  });

  it('still refuses to turn on with an AltGr key', async () => {
    const shell = fakeQuickShell({ enabled: false, key: 'Ctrl+Alt+Q' });
    renderSection();
    const toggle = await screen.findByRole('switch', { name: 'Turn on the quick capture shortcut' });
    await userEvent.click(toggle);
    await screen.findByText(/is also AltGr/);
    expect(shell.saved.enabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('warns about OpenNote commands the typed keys would shadow before they are saved', async () => {
    stops.push(
      commands.register(
        defineCommand({
          id: 'test.quickClash',
          title: 'theme.commands.toggle',
          category: 'general',
          keys: [chord('Ctrl+Shift+K')],
          run() {},
        }),
      ),
    );
    const shell = fakeQuickShell({ enabled: false, key: 'Win+Shift+Q' });
    renderSection();
    const field = (await screen.findByRole('textbox', { name: 'Shortcut' })) as HTMLInputElement;
    await userEvent.clear(field);
    await userEvent.type(field, 'Ctrl+Shift+K');
    await screen.findByText(/OpenNote uses these keys for/);
    expect(shell.sets).toEqual([]);
  });
});
