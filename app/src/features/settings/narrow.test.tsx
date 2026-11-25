// Settings at 600 px, and with large text: no section scrolls sideways (walk 9, R-VA-2).
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { closeOverlay } from '../../shell/commandbar/overlays';
import { pressChord, renderApp, setViewport } from '../../test';

afterEach(async () => {
  closeOverlay();
  document.documentElement.style.fontSize = '';
  document.documentElement.removeAttribute('data-density');
  await setViewport(1280, 800);
});

const SECTIONS = ['General', 'Appearance', 'Editing', 'Recording', 'Pen and touch', 'Storage and backups', 'About'];

/** Elements under the page that run past the right edge of the settings main column. */
function wide(): string[] {
  const main = document.querySelector('main[class*="body"]') as HTMLElement;
  const edge = main.getBoundingClientRect().left + main.clientWidth;
  const out = [main.scrollWidth > main.clientWidth + 1 ? `MAIN ${main.scrollWidth}>${main.clientWidth}` : ''];
  for (const el of main.querySelectorAll('*')) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.right > edge + 1)
      out.push(
        `${el.tagName}.${(el as HTMLElement).className}:${Math.round(box.right - edge)} in ${el.closest('section')?.id}`,
      );
  }
  return out.filter(Boolean).slice(0, 8);
}

describe('Settings in a small window', () => {
  it.each([
    [600, 1],
    [600, 2],
    [400, 2],
    [300, 2],
  ])('has no sideways scroll at %i px with text at %i x', async (width, scale) => {
    await setViewport(width, 900);
    document.documentElement.style.fontSize = `${scale * 100}%`;
    await renderApp();
    await pressChord('Ctrl+,');
    for (const name of SECTIONS) {
      const link = await screen.findByRole('link', { name });
      await userEvent.click(link);
      await screen.findByRole('heading', { level: 1, name });
      await new Promise((done) => setTimeout(done, 300));
      expect(wide(), name).toEqual([]);
      // Back to the list on the compact screens.
      const back = screen.queryByRole('button', { name: 'Back to settings' });
      if (back) await userEvent.click(back);
    }
  });

  it('wraps a long program path in General at 300 px with text at 2 x', async () => {
    await setViewport(300, 900);
    document.documentElement.style.fontSize = '200%';
    const exePath = [
      'D:',
      'Programs',
      'SomeLongFolderName',
      'AnotherLongFolderName',
      'ThirdFolder',
      'OpenNote.exe',
    ].join(String.fromCharCode(92));
    await renderApp({ boot: { install: { isDevBuild: false, inUserPrograms: false, exePath } } });
    await pressChord('Ctrl+,');
    await userEvent.click(await screen.findByRole('link', { name: 'General' }));
    await screen.findByText(/OpenNote runs from/);
    await new Promise((done) => setTimeout(done, 300));
    expect(wide()).toEqual([]);
  });
});
