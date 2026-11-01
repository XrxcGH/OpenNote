// Every kit window opens from the palette and shows its words, tab by tab. A kit keeps only its start-up words at
// start-up and loads the rest with its code, so a window that read a word before that code loaded would show a raw
// key such as `kitAero.tab` or the text "undefined". No unit test sees this, because each kit's tests import the
// kit's text themselves.
import { expect, test } from '../fixtures';
import { openSmart, runCommand } from './smart';

const KITS: readonly (readonly [string, string])[] = [
  ['Aerospace', 'Open the aerospace tools'],
  ['Chemistry and materials', 'Open Chemistry and materials'],
  ['Civil', 'Open traffic, highways, surveying, and site planning'],
  ['Control', 'Open the dynamics and control tools'],
  ['Design', 'Open the design tools'],
  ['Economics', 'Open economics and finance tools'],
  ['Circuits and energy', 'Open the circuits and energy tools'],
  ['Fluids and heat', 'Open the fluid mechanics and heat transfer tools'],
  ['Humanities', 'Open the history, places, languages, and texts kit'],
  ['Mathematics', 'Open the engineering mathematics tools'],
  ['Mechanisms and dynamics', 'Open the mechanisms and dynamics kit'],
  ['Biology', 'Open the biology tools'],
  ['Music', 'Open the music, script, camera, and studio tools'],
  ['Physics', 'Open physics tools'],
  ['Reasoning', 'Open the reasoning kit'],
  ['Solids', 'Open the solid mechanics tools'],
  ['Thermodynamics', 'Open the thermodynamics kit'],
];

const RAW = /\bkit[A-Z]\w*\.\w+|\bundefined\b/;

for (const [name, command] of KITS) {
  test(`${name}: every tab shows words, never raw keys`, async ({ page }) => {
    test.setTimeout(120_000);
    await openSmart(page);
    await runCommand(page, command);
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).not.toContainText(/^Opening/, { timeout: 15_000 });
    const everything = () =>
      dialog.evaluate((el) =>
        [
          (el as HTMLElement).innerText,
          ...[...el.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap((n) =>
            ['aria-label', 'title', 'placeholder'].map((a) => n.getAttribute(a) ?? ''),
          ),
        ].join('\n'),
      );
    expect(await everything()).not.toMatch(RAW);
    const tabs = dialog.getByRole('tab');
    const count = await tabs.count();
    for (let i = 0; i < count; i += 1) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
      expect(await everything(), `tab ${i} of ${name}`).not.toMatch(RAW);
    }
  });
}
