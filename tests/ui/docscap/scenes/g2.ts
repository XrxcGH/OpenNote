// Capture scenes of group g2 (see docs/tools/screens.json for the names, categories, and captions): study and
// homework, math and calculators, connectors, the settings sections, and the tool windows.
import { expect, type Locator, type Page } from '@playwright/test';
import type { Helpers, Scene } from '../more';

/** A scene with the two extras capture.spec.ts reads from a shot: a start address and boot overrides. */
type G2Scene = Scene & { path?: string; boot?: Record<string, unknown> };

const textBox = (p: Page) => p.getByRole('textbox', { name: 'Text' }).first();
const dialog = (p: Page, name: string | RegExp) => p.getByRole('dialog', { name });

/** Puts the caret on a new empty line at the end of the open page, trying again if the caret did not get there. */
async function endOfPage(p: Page) {
  const box = textBox(p);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await box.locator('p').last().click();
    await expect(box).toHaveAttribute('contenteditable', 'true');
    await p.waitForTimeout(400);
    await p.keyboard.press('Control+End');
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    if ((await box.locator('p').last().innerText()).trim() === '') return;
  }
}

/** Types lines at the caret, pressing Enter between them. */
async function typeLines(p: Page, lines: string[]) {
  for (const [i, line] of lines.entries()) {
    if (i > 0) await p.keyboard.press('Enter');
    await p.keyboard.type(line);
  }
  // The lines must be the end of the page, or the picture shows them in the middle of a sentence.
  await expect(textBox(p).locator('p').last()).toHaveText(lines[lines.length - 1]);
}

/** Types a slash command and takes the named item: arrow down to it, because the list re-sorts as it settles. */
async function slash(p: Page, text: string, item: string) {
  await p.keyboard.type(text);
  const option = p.getByRole('option', { name: item });
  await expect(option).toBeVisible();
  await p.waitForTimeout(600);
  const index = Number(await option.getAttribute('data-index'));
  for (let i = 0; i < index; i += 1) await p.keyboard.press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await p.keyboard.press('Enter');
}

/** Scrolls a window and everything in it back to the top. */
const scrollTops = (d: Locator) =>
  d.evaluate((e) => {
    for (const el of [e, ...e.querySelectorAll('*')]) if (el.scrollTop) el.scrollTop = 0;
  });

/** Fixes Math.random, so a quiz or a paper that picks at random comes out the same each time. */
const fixRandom = (p: Page) =>
  p.evaluate(() => {
    let seed = 7;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  });

const CELL_NOTES = [
  'Mitochondria: the organelle that releases energy from glucose in respiration.',
  'Ribosome: the small structure where proteins are made from amino acids.',
  'Nucleus: the part of the cell that holds the genetic material and controls it.',
  'Chloroplast: the organelle where plants capture light for photosynthesis.',
];

const CARDS = [
  'Largest organ of the human body :: The skin',
  'Powerhouse of the cell :: The mitochondrion',
  'The {{nucleus}} holds the genetic material',
  'Where proteins are made :: Ribosomes',
];

export const scenes: (h: Helpers) => Scene[] = (h) => {
  /** The Mitosis page, open, with the notes typed in and a block of extra lines under them. */
  async function withLines(p: Page, lines: string[]) {
    await h.typeNotes(p);
    await endOfPage(p);
    await typeLines(p, lines);
    await p.waitForTimeout(2500);
  }

  /** Starts the app again with a notes folder chosen, as it is for a person who has set one. */
  async function withNotesFolder(p: Page) {
    await p.addInitScript(() => {
      const boot = window.__OPENNOTE_BOOT__ as unknown as { settings: Record<string, unknown> };
      boot.settings = { ...boot.settings, storage: { notesFolder: 'C:\\Users\\Ada\\Documents\\OpenNote' } };
    });
    await p.reload();
  }

  async function cardsDeck(p: Page) {
    await withLines(p, CARDS);
    await h.command(p, 'Open flashcards', 'Open flashcards');
    const d = dialog(p, 'Flashcards');
    await expect(d.getByText(/4 cards/)).toBeVisible();
    return d;
  }

  async function examOn(p: Page) {
    await h.openPage(p, 'Lectures', 'Cell structure');
    await endOfPage(p);
    await typeLines(p, CELL_NOTES);
    await p.waitForTimeout(1500);
    await h.command(p, 'Make a practice exam from this section', 'Make a practice exam from this section');
    const d = dialog(p, 'Practice exams');
    await expect(d).toBeVisible();
    await fixRandom(p);
    await d.getByLabel('Number of questions').fill('4');
    await d.getByRole('button', { name: 'Make exam' }).click();
    await expect(d.getByText(/^4 questions, \d+ marks in all\./)).toBeVisible();
    await d.getByRole('button', { name: 'Start exam' }).click();
    await expect(d.getByRole('heading', { name: 'Question 1 of 4' })).toBeVisible();
    return d;
  }

  /** Answers the question that is showing: a choice if it has choices, else the words typed in its box. */
  async function answerQuestion(d: Locator, step: number) {
    const question = d.getByRole('region', { name: /^Question \d of 4/ });
    const choices = question.getByRole('radio');
    if (await choices.count()) return choices.nth(step % 2 ? 1 : 0).check();
    const words = ['Chloroplast', 'Mitochondria', 'Ribosome', 'Nucleus'];
    await question.getByRole('textbox').first().fill(words[step]);
  }

  async function equation(p: Page, source: string) {
    await h.typeNotes(p);
    await endOfPage(p);
    await p.keyboard.press('Alt+=');
    // The equation opens as a source box, or as the visual editor once that loads; the buttons are the same.
    await p.getByRole('button', { name: 'Solve', exact: true }).waitFor();
    await p.waitForTimeout(1500);
    await p.keyboard.insertText(source);
  }

  const scenes: G2Scene[] = [
    {
      name: 'print-preview',
      quick: true,
      run: async (p) => {
        await h.typeNotes(p);
        await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await p.keyboard.press('Control+KeyP');
        const d = dialog(p, 'Print');
        await d.waitFor();
        await expect(d.getByText('Sheet 1 of 1')).toBeVisible({ timeout: 30_000 });
        await d.getByLabel('Printer').selectOption({ label: 'Studio Printer (default)' });
        await d.getByRole('textbox', { name: 'Header' }).fill('{title}');
        await d.getByRole('textbox', { name: 'Footer' }).fill('Page {page} of {pages}');
        await d.getByRole('heading', { name: 'Print' }).click();
        await scrollTops(d);
        await p.waitForTimeout(1500);
      },
    },
    {
      name: 'flashcard-review',
      run: async (p) => {
        const d = await cardsDeck(p);
        await d.locator('li button').first().click();
        await d.getByRole('button', { name: 'Rename deck' }).click();
        await d.getByRole('textbox', { name: 'Deck name' }).fill('Cell biology facts');
        await p.keyboard.press('Enter');
        await d.getByRole('button', { name: 'Review', exact: true }).click();
        await d.getByRole('button', { name: 'Show answer' }).click();
        await expect(d.getByRole('button', { name: 'Good' })).toBeVisible();
      },
    },
    {
      name: 'quiz-block',
      run: async (p) => {
        await withLines(p, CARDS);
        await endOfPage(p);
        await slash(p, '/quiz', 'Insert quiz');
        await fixRandom(p);
        await p.getByRole('button', { name: 'Start quiz' }).click();
        const answer = p.getByRole('textbox', { name: /Your answer/ }).first();
        const asked = (await answer.locator('xpath=ancestor::*[contains(., "Question 1 of")][1]').innerText()) ?? '';
        const key: [string, string][] = [
          ['organ', 'The skin'],
          ['Powerhouse', 'The mitochondrion'],
          ['proteins', 'Ribosomes'],
        ];
        await answer.fill(key.find(([word]) => asked.includes(word))?.[1] ?? 'The skin');
        await p.getByRole('button', { name: 'Check answer' }).click();
        await expect(p.getByRole('status').filter({ hasText: /right|Not this time/ })).toBeVisible();
      },
    },
    {
      name: 'step-checker',
      run: async (p) => {
        await h.typeNotes(p);
        await endOfPage(p);
        await typeLines(p, ['2x + 3 = 7', '2x = 10', 'x = 5']);
        await p.keyboard.press('Shift+ArrowUp');
        await p.keyboard.press('Shift+ArrowUp');
        await p.keyboard.press('Shift+Home');
        await textBox(p)
          .locator('p')
          .filter({ hasText: /^2x = 10$/ })
          .click({ button: 'right' });
        await p.getByRole('menuitem', { name: 'Check my work' }).click();
        await expect(p.locator('[data-step-mark="broken"]')).toHaveCount(1);
        await p.getByRole('region', { name: 'Check my work' }).waitFor();
      },
    },
    {
      name: 'practice-exam',
      run: async (p) => {
        const d = await examOn(p);
        await answerQuestion(d, 0);
      },
    },
    {
      name: 'practice-exam-results',
      run: async (p) => {
        const d = await examOn(p);
        for (let step = 0; step < 4; step += 1) {
          await answerQuestion(d, step);
          if (step < 3) await d.getByRole('button', { name: 'Next question' }).click();
        }
        await d.getByRole('button', { name: 'Submit exam' }).click();
        await expect(d.getByRole('heading', { name: /^Score: / })).toBeVisible();
      },
    },
    {
      name: 'citations',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Open citations', 'Open citations');
        const d = dialog(p, 'Citations');
        const add = async (title: string, authors: string, year: string, container: string) => {
          await d.getByRole('button', { name: 'Add a source' }).click();
          if (container) await d.getByLabel('Kind of source').selectOption({ label: 'Article' });
          await d.getByLabel('Title', { exact: true }).fill(title);
          await d.getByLabel('Authors, one to a line').fill(authors);
          await d.getByLabel('Year', { exact: true }).fill(year);
          if (container) await d.getByLabel('Journal, website, or series').fill(container);
          await d.getByRole('button', { name: 'Save source' }).click();
        };
        await add('Molecular Biology of the Cell', 'Bruce Alberts\nAlexander Johnson', '2015', '');
        await add('The mitotic spindle in action', 'Sofia Ramirez', '2021', 'Journal of Cell Science');
        await expect(d.getByRole('heading', { name: 'Bibliography' })).toBeVisible();
        await scrollTops(d);
      },
    },
    {
      name: 'calc-graphing',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Graphing calculator', 'Graphing calculator');
        const d = dialog(p, 'Calculator');
        await d.getByRole('tab', { name: 'Graphing 2D' }).click();
        await d.getByRole('button', { name: 'Add a function' }).click();
        await d.getByRole('textbox', { name: 'Function 2' }).fill('y = x / 3');
        const plot = d.getByRole('application', { name: /^Graph of 2 functions/ });
        await expect(plot).toBeVisible();
        const box = (await plot.boundingBox())!;
        await p.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
      },
    },
    {
      name: 'calc-graphing-3d',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, '3D graphing calculator', '3D graphing calculator');
        const d = dialog(p, 'Calculator');
        await d.getByRole('separator', { name: /^Resize Calculator/ }).focus();
        for (let i = 0; i < 22; i += 1) await p.keyboard.press('ArrowLeft');
        await d.getByRole('heading', { name: 'Calculator' }).click();
        await expect(d.getByRole('application', { name: /^3D graph of/ })).toBeVisible({ timeout: 20_000 });
      },
    },
    {
      name: 'solvers-integrals',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Solve a double or triple integral', /Solve a double or triple integral/);
        const d = dialog(p, 'Math solvers');
        await expect(d.getByText('Value: 4π/3')).toBeVisible({ timeout: 20_000 });
      },
    },
    {
      name: 'solvers-equations',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Solve a differential equation', /Solve a differential equation/);
        const d = dialog(p, 'Math solvers');
        await expect(d.getByRole('tab', { name: 'Equations' })).toHaveAttribute('aria-selected', 'true', {
          timeout: 20_000,
        });
      },
    },
    {
      name: 'math-actions',
      run: async (p) => {
        await equation(p, 'x^2 - 5x + 6 = 0');
        await p.getByRole('button', { name: 'Solve', exact: true }).click();
        await p.waitForTimeout(1000);
        await p.keyboard.press('Enter');
        await endOfPage(p);
        await p.keyboard.press('Alt+=');
        await p.getByRole('button', { name: 'Steps' }).waitFor();
        await p.waitForTimeout(1500);
        await p.keyboard.insertText('x^3 + 2x');
        await p.getByRole('button', { name: 'Steps' }).click();
        await expect(p.locator('[data-math-steps]')).toContainText('Steps for the derivative');
        await p.getByRole('button', { name: /^Insert these steps/ }).click();
        // Click away to keep the equation, as Escape would cancel it.
        await textBox(p).getByText('Question for Thursday').click();
        await p.waitForTimeout(800);
        await p
          .getByRole('math')
          .first()
          .evaluate((e) => e.scrollIntoView({ block: 'center' }));
      },
    },
    {
      name: 'graph-3d',
      run: async (p) => {
        await h.typeNotes(p);
        await endOfPage(p);
        await slash(p, '/3d graph', 'Insert 3D graph');
        const plot = p.getByRole('application', { name: /^3D graph of/ });
        await expect(plot).toBeVisible({ timeout: 20_000 });
        await plot.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      },
    },
    {
      name: 'unit-converter',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Open the unit converter', 'Open the unit converter');
        const d = dialog(p, 'Unit converter');
        await d.waitFor();
        const units = d.getByRole('combobox', { name: 'Unit', exact: true });
        await units.first().selectOption('m');
        await units.nth(1).selectOption('ft');
        await d.getByRole('textbox', { name: 'From' }).fill('100');
        await expect(d.getByRole('textbox', { name: 'To' })).toHaveValue(/^328\.08/);
      },
    },
    {
      name: 'connector-prompt',
      path: '/?connectors=ready',
      run: async (p) => {
        await h.settings(p, 'Connectors');
        const google = p.getByRole('article', { name: /Google/ }).first();
        await google.getByRole('button', { name: /^Connect( |$)/ }).click();
      },
    },
    { name: 'settings-language', run: (p) => h.settings(p, 'Language') },
    { name: 'settings-recording', run: (p) => h.settings(p, 'Recording') },
    { name: 'settings-pen', run: (p) => h.settings(p, 'Pen and touch') },
    { name: 'settings-my-handwriting', run: (p) => h.settings(p, 'My handwriting') },
    {
      name: 'settings-storage',
      run: async (p) => {
        await withNotesFolder(p);
        await h.settings(p, 'Storage and backups');
      },
    },
    { name: 'settings-updates', run: (p) => h.settings(p, 'Updates') },
    { name: 'settings-windows', run: (p) => h.settings(p, 'Windows and power') },
    { name: 'settings-app-permissions', run: (p) => h.settings(p, 'App permissions') },
    { name: 'settings-help', run: (p) => h.settings(p, 'Help') },
    {
      name: 'accessibility-checker',
      path: '/?fixture=unlabeled',
      run: async (p) => {
        await h.openPage(p, 'Lectures', 'Membranes');
        await expect(p.getByText('A picture follows.')).toBeVisible();
        await h.command(p, 'Check accessibility', 'Check accessibility');
        await expect(dialog(p, 'Check accessibility')).toContainText('Found 1 problem.');
      },
    },
    {
      name: 'dictionary',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Open the dictionary', 'Open the dictionary');
        const d = dialog(p, 'Dictionary');
        await d.getByRole('textbox', { name: 'Word' }).fill('happy');
        await expect(d.getByRole('heading', { name: 'Adjective' })).toBeVisible();
      },
    },
    {
      name: 'reference-tables',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'reference tables', /Open the reference tables/);
        await p.getByRole('tab', { name: 'Elements' }).click();
      },
    },
  ];
  return scenes;
};
