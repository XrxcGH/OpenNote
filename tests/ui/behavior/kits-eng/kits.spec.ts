// The engineering kits open from the palette with their default example worked out, show one number a person can
// check by hand, and recompute when an input changes.
import { expect, test } from '../../fixtures';
import { expectRecompute, openKit, resultRow } from './open';

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
  await dialog.getByLabel(/^Crank, a/).fill('90');
  await expect(resultRow(dialog, /^Grashof class/)).not.toContainText('Crank-rocker');
});

test('solid mechanics: the Euler load falls to a quarter at twice the length', async ({ page }) => {
  const dialog = await openKit(page, 'Open the solid mechanics tools', 'Solid mechanics');
  const length = dialog.getByLabel(/^Length, L/);
  await expectRecompute(dialog, /^Euler critical load/, '1754.6 kN', length, '6', '438.65 kN');
});

test('chemistry and materials: the default reaction is spontaneous at 298 K', async ({ page }) => {
  const dialog = await openKit(page, 'Open Chemistry and materials', 'Chemistry and materials');
  await expect(resultRow(dialog, /^Reaction enthalpy/)).toContainText('−91.88');
  await expect(dialog).toContainText('Spontaneous (ΔG° is negative)');
  await dialog.getByRole('combobox', { name: 'Chemistry and materials' }).selectOption('Chemical equilibrium');
  await expect(dialog).not.toContainText('Spontaneous (ΔG° is negative)');
});

test('design tools: a line added by coordinates fills the empty sheet', async ({ page }) => {
  const dialog = await openKit(page, 'Open the design tools', 'Design tools');
  await expect(dialog).toContainText('The sheet is empty');
  await dialog.getByLabel('To x').fill('80');
  await dialog.getByRole('button', { name: 'Add the shape' }).click();
  await expect(dialog).not.toContainText('The sheet is empty');
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
});
