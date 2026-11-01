// The engineering kits open from the palette with their default example worked out, show one number a person can
// check by hand, and recompute when an input changes.
import { expect, test } from '../../fixtures';
import { expectNoErrors, expectRecompute, openKit, resultRow } from './open';

// A kit that logs an error or throws, even one the page recovers from, fails its test.
test.afterEach(({ page }) => expectNoErrors(page));

test('thermodynamics: steam at 400 °C and 1 MPa, then 200 °C', async ({ page }) => {
  const dialog = await openKit(page, 'Open the thermodynamics kit', 'Thermodynamics kit');
  // Superheated steam at 200 °C and 1 MPa, h = 2828.3 kJ/kg (IAPWS-IF97).
  const temperature = dialog.getByLabel('Temperature', { exact: true }).first();
  await expectRecompute(dialog, /^Enthalpy/, '3264.4', temperature, '200', '2828.3');
});

test('fluids and heat: force on a vertical gate scales with the fluid density', async ({ page }) => {
  const dialog = await openKit(page, 'Open the fluid mechanics and heat transfer tools', 'Fluids and heat transfer');
  const density = dialog.getByLabel(/^Fluid density/);
  await expectRecompute(dialog, /^Resultant force/, '51485', density, '800', '41188');
});

test('mechanisms and dynamics: the default four-bar is a crank-rocker', async ({ page }) => {
  const dialog = await openKit(page, 'Open the mechanisms and dynamics kit', 'Mechanisms and dynamics');
  await expect(resultRow(dialog, /^Grashof class/)).toContainText('Crank-rocker');
  await expect(resultRow(dialog, /^Transmission angle/)).toContainText('28.449');
  // Links of 90, 70, 90, and 60 mm: the shortest link is the ground, and s + l = 150 <= p + q = 160 makes a drag link.
  await dialog.getByLabel(/^Crank, a/).fill('90');
  await expect(resultRow(dialog, /^Grashof class/)).toContainText('Double crank (drag link)');
  await expect(resultRow(dialog, /^Transmission angle/)).toContainText('32.276');
});

test('solid mechanics: the Euler load falls to a quarter at twice the length', async ({ page }) => {
  const dialog = await openKit(page, 'Open the solid mechanics tools', 'Solid mechanics');
  const length = dialog.getByLabel(/^Length, L/);
  await expectRecompute(dialog, /^Euler critical load/, '1754.6 kN', length, '6', '438.65 kN');
});

test('chemistry and materials: the default reaction is spontaneous at 298 K', async ({ page }) => {
  const dialog = await openKit(page, 'Open Chemistry and materials', 'Chemistry and materials');
  await expect(resultRow(dialog, /^Reaction enthalpy/)).toContainText('−91.88');
  // N2 + 3 H2 -> 2 NH3: dG = -91.88 - 298.15 x (-0.19811) = -32.814 kJ/mol.
  await expect(resultRow(dialog, /^Gibbs energy ΔG° at 298\.15 K/)).toContainText('−32.814');
  await expect(dialog).toContainText('Spontaneous (ΔG° is negative)');
  // At 1000 K the entropy term wins: dG = -91.88 + 198.11 = +106.2 kJ/mol, so K falls far below 1.
  await dialog.getByRole('textbox', { name: 'Temperature' }).fill('1000');
  await expect(resultRow(dialog, /^Gibbs energy ΔG° at the chosen temperature/)).toContainText('106.2');
  await expect(resultRow(dialog, /^Equilibrium constant K at the chosen temperature/)).toContainText('2.827e−6');
});

test('design tools: a line from (0, 0) to (80, 0) is listed with its coordinates and follows an edit', async ({
  page,
}) => {
  const dialog = await openKit(page, 'Open the design tools', 'Design tools');
  await expect(dialog).toContainText('The sheet is empty', { timeout: 20_000 });
  await dialog.getByLabel('From x').fill('0');
  await dialog.getByLabel('From y').fill('0');
  await dialog.getByLabel('To x').fill('80');
  await dialog.getByLabel('To y').fill('0');
  await dialog.getByRole('button', { name: 'Add the shape' }).click();
  await expect(dialog).not.toContainText('The sheet is empty', { timeout: 20_000 });
  // The sheet is in mm, so the line is 80 mm long.
  const line = dialog.getByRole('button', { name: 'Line (0, 0) → (80, 0)' });
  await expect(line).toBeVisible();
  await dialog.getByRole('region', { name: 'Selected: Line' }).getByLabel('To x').fill('120');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Line (0, 0) → (120, 0)' })).toBeVisible();
});

test('circuits and energy: a series RLC is underdamped at 100 ohms and critical at 200', async ({ page }) => {
  const dialog = await openKit(page, 'Open the circuits and energy tools', 'Circuits and energy');
  const damping = dialog.locator('dt', { hasText: /^Damping$/ }).locator('xpath=following-sibling::dd[1]');
  await expect(damping).toHaveText('Underdamped');
  // Critical damping is R = 2 sqrt(L / C) = 200 ohms for 0.1 H and 10 uF.
  await dialog.getByRole('textbox', { name: 'Resistance R (Ω)' }).fill('200');
  await expect(damping).toHaveText(/Critically damped/);
});

test('electric and magnetic fields: the default charges give 17.975 N/C', async ({ page }) => {
  const dialog = await openKit(page, 'Open the electric and magnetic fields tool', 'Physics tools');
  await expect(dialog).toContainText('|E| = 17.975 N/C');
  // Each charge is x, y, q. Doubling the first adds 8.9876 N/C to the 8.9876 N/C of the second: 26.963 N/C.
  const charges = dialog.getByRole('textbox', { name: 'Charges' });
  await charges.fill('-1 0 2\n1 0 -1');
  await expect(dialog).toContainText('|E| = 26.963 N/C');
  // Equal charges cancel at the midpoint between them.
  await charges.fill('-1 0 1\n1 0 1');
  await expect(dialog).toContainText('|E| = 0 N/C');
});

test.describe('dark theme on a wide screen', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 2560, height: 1300 } });

  test('electric and magnetic fields: the default charges still give 17.975 N/C', async ({ page }) => {
    const dialog = await openKit(page, 'Open the electric and magnetic fields tool', 'Physics tools');
    await expect(dialog).toContainText('|E| = 17.975 N/C');
  });
});
