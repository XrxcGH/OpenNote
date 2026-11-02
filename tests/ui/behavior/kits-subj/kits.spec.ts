// The catalog subject kits on the web platform: each window opens from the palette, runs its default example on
// open, shows one known number, and changes that number when a field changes. The checks are separate tests so a
// failure names the kit.
import { expect, test } from '../../fixtures';
import { kitById, loose, openKit } from './kit';

// A kit window loads its engines when it first opens, which is slow on a busy machine.
test.describe.configure({ timeout: 90_000 });

test('civil: the continuous beam example gives its reactions, and another topic replaces them', async ({ page }) => {
  const dialog = await openKit(page, kitById('civil'));
  await expect(dialog).toContainText(loose('The largest bending moment is -45 kN·m, at 6 m.'));
  await expect(dialog).toContainText(loose('Support reaction 2: 75.0000 kN'));
  await dialog.getByRole('combobox').first().selectOption({ label: 'Hydrology and open channels' });
  await expect(dialog).not.toContainText(loose('Support reaction 2'));
});

test('earth: 50 percent humidity at 20 degrees has a dew point of 9.27 degrees, and 100 percent has 20', async ({
  page,
}) => {
  const dialog = await openKit(page, kitById('earth'));
  await expect(dialog).toContainText(loose('Dew point 9.27009 °C'));
  await dialog.getByLabel('Relative humidity (%)').fill('100');
  await expect(dialog).toContainText(/Dew point\s*(20|19\.99\d*)\s*°C/);
});

test('humanities: the frame library lists 42 frames and a search narrows them', async ({ page }) => {
  const dialog = await openKit(page, kitById('humanities'));
  await expect(dialog).toContainText(loose('Frames (42 frames)'));
  await dialog.getByLabel('Search frames').fill('essay');
  await expect(dialog).not.toContainText('Frames (42 frames)');
  await expect(dialog).toContainText(loose('Essay planner'));
});

test('life systems: 70 beats a minute at 70 mL is 4.9 L/min, and 80 beats a minute is 5.6', async ({ page }) => {
  const dialog = await openKit(page, kitById('lifesys'));
  await expect(dialog).toContainText(loose('Cardiac output 4.9 L/min'));
  await dialog.getByLabel('Heart rate (beats/min)').fill('80');
  await expect(dialog).toContainText(loose('Cardiac output 5.6 L/min'));
});

test('math kit: the series of 1/n^2 sums to pi squared over six, and 1/n^3 to 1.2020569', async ({ page }) => {
  const dialog = await openKit(page, kitById('mathkit'));
  await expect(dialog).toContainText(loose('about 1.644934067'));
  await dialog.getByLabel('Term, using n').fill('1/n^3');
  await expect(dialog).toContainText(loose('about 1.202056903'));
});

test('modern physics: the plasma example has a Debye length of 23.508 micrometers, and four times the temperature doubles it', async ({
  page,
}) => {
  const dialog = await openKit(page, kitById('modphys'));
  await expect(dialog).toContainText(loose('Debye length λ_D: 23.508 µm'));
  const field = dialog.getByLabel('Electron temperature').first();
  const before = Number(await field.inputValue());
  await field.fill(String(before * 4));
  await expect(dialog).toContainText(/Debye length λ_D: 47\.01\d\s*µm/);
});

test('molecular biology: the example sequence is 39 bases at 56.41 percent GC, and a new sequence recounts', async ({
  page,
}) => {
  const dialog = await openKit(page, kitById('molbio'));
  await expect(dialog).toContainText(loose('Length (bases) 39'));
  await expect(dialog).toContainText(loose('GC content 56.41'));
  await dialog.getByLabel('Sequence', { exact: true }).fill('ATGC');
  await expect(dialog).toContainText(loose('Length (bases) 4'));
  await expect(dialog).toContainText(loose('GC content 50'));
});

test('music: the C major scale example has eight notes, and a new tune is read in G', async ({ page }) => {
  const dialog = await openKit(page, kitById('music'));
  await expect(dialog).toContainText(loose('Key C major'));
  await expect(dialog).toContainText(loose('Notes and chords 8'));
  await dialog.getByLabel('Music in ABC notation').fill('X:1\nM:3/4\nL:1/4\nK:G\nGAB|');
  await expect(dialog).toContainText(loose('Key G major'));
  await expect(dialog).toContainText(loose('Meter 3/4'));
  await expect(dialog).toContainText(loose('Notes and chords 3'));
});

test('reasoning: the example formula is a tautology in 8 rows, and p and q is not, in 4', async ({ page }) => {
  const dialog = await openKit(page, kitById('reasoning'));
  await expect(dialog).toContainText(loose('A tautology: true in all 8 rows.'));
  await dialog.getByLabel('Formula', { exact: true }).fill('p and q');
  await expect(dialog).toContainText(loose('4 rows in all'));
  await expect(dialog).not.toContainText(loose('A tautology'));
});

test('signals: the example spectrum peaks at 9.997 Hz, and doubling the sample rate doubles the bin width', async ({
  page,
}) => {
  const dialog = await openKit(page, kitById('signals'));
  await expect(dialog).toContainText(loose('Largest peak: 1.00438 at 9.99716 Hz.'));
  await expect(dialog).toContainText(loose('Bin width 0.5 Hz'));
  await dialog.getByLabel('Sample rate (Hz)').fill('512');
  await expect(dialog).toContainText(loose('Bin width 1 Hz'));
});

test('statistics inference: the example data has mean 5 and deviation 2.1381, and new data recomputes', async ({
  page,
}) => {
  const dialog = await openKit(page, kitById('statinfer'));
  await expect(dialog).toContainText(loose('Mean 5, standard deviation 2.13809, n = 8.'));
  await dialog.getByLabel('Data', { exact: true }).fill('1 2 3 4 5');
  await expect(dialog).toContainText(loose('Mean 3, standard deviation 1.58114, n = 5.'));
});

test('statistical models: the example regression has R² 0.99956 on 10 rows, and the survival tab replaces it', async ({
  page,
}) => {
  const dialog = await openKit(page, kitById('statmodels'));
  await expect(dialog).toContainText(loose('R² 0.99956'));
  await expect(dialog).toContainText(loose('Rows used 10'));
  await dialog.getByRole('tab', { name: 'Survival analysis' }).click();
  await expect(dialog.getByRole('tab', { name: 'Survival analysis' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog).not.toContainText('Residual standard error');
});
