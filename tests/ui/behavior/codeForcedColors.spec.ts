// The code editor under a Windows contrast theme (code:L21, BRAND.md section 4). The squiggle, the ghost text, the
// selection, and the focus ring must each stay visible without a color of ours. A test hook mounts the editor.

import { expect, test } from '../fixtures';

type Hooks = Record<string, (...args: unknown[]) => unknown>;

test.use({ boot: { os: { contrast: true, dark: true }, settings: { appearance: { theme: 'dark' } } } });

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps the squiggle, ghost text, selection, and focus ring visible in forced colors, ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme });
    await page.goto('/');
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.codeEditorMount),
    );
    await page.evaluate(async () => {
      const hooks = (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__;
      await hooks.codeEditorMount({ language: 'python', text: 'print(totl)\n', suggest: { when: 'x', then: 'yz' } });
      hooks.codeEditorProblem(6, 4, "Undefined name 'totl'");
    });
    const content = page.locator('[data-testid="code-editor-host"] .cm-content');
    await content.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('x');

    const squiggle = page.locator('.cm-lintRange-error').first();
    await expect(squiggle).toBeVisible();
    const line = await squiggle.evaluate((el) => {
      const style = getComputedStyle(el);
      return { kind: style.textDecorationLine, shape: style.textDecorationStyle, image: style.backgroundImage };
    });
    expect(line).toEqual({ kind: 'underline', shape: 'wavy', image: 'none' });

    const ghost = page.locator('.cm-ghost-text').first();
    await expect(ghost).toBeVisible();
    expect(await ghost.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');

    const ring = await page.locator('[data-testid="code-editor-host"] .cm-editor').evaluate((el) => {
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style.color = 'Highlight';
      const style = getComputedStyle(el);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        color: style.outlineColor,
        wanted: getComputedStyle(probe).color,
      };
    });
    expect(ring.style).toBe('solid');
    expect(ring.width).not.toBe('0px');
    expect(ring.color).toBe(ring.wanted);

    await page.keyboard.press('Control+a');
    const selected = await page
      .locator('.cm-selectionBackground')
      .first()
      .evaluate((el) => {
        const probe = document.body.appendChild(document.createElement('div'));
        probe.style.background = 'Highlight';
        return { shown: getComputedStyle(el).backgroundColor, wanted: getComputedStyle(probe).backgroundColor };
      });
    expect(selected.shown).toBe(selected.wanted);
  });
}
