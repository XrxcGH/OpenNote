// Capture scenes of group g1 (see docs/tools/screens.json for the names, categories, and captions).
import { expect, type Page } from '@playwright/test';
import { choose, draw, ellipse, line, type Point } from '../../ink';
import { press } from '../../paperSnap';
import type { Helpers, Scene } from '../more';

const notebooks = (p: Page) => p.getByRole('tree', { name: 'Notebooks' });
const pagesTree = (p: Page) => p.getByRole('tree', { name: 'Pages' });
const textBox = (p: Page) => p.getByRole('textbox', { name: 'Text' }).first();

/** Types a line of steps: text, or a key in braces, such as "{Enter}". */
async function keys(p: Page, steps: string): Promise<void> {
  for (const part of steps.split(/(\{[^}]+\})/).filter(Boolean)) {
    if (part.startsWith('{')) await p.keyboard.press(part.slice(1, -1));
    else await p.keyboard.type(part);
  }
}

/** Clicks into the page text and goes to the end of it, ready to type a new line. */
async function toEnd(p: Page): Promise<void> {
  const box = textBox(p);
  await box.click();
  await expect(box).toHaveAttribute('contenteditable', 'true');
  await p.keyboard.press('Control+End');
}

/** Waits until the chunks the page's commands need have loaded, so a command is not run after the keys behind it. */
const commandsReady = (p: Page) => p.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });

const blur = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

const wavy = (x0: number, y: number, w: number, amp: number, cycles: number): Point[] =>
  Array.from({ length: 41 }, (_, i) => [x0 + (w * i) / 40, y + amp * Math.sin((i / 40) * cycles * 6.2832)]);

const WIDE = { width: 1600, height: 900 };
const NL = String.fromCharCode(10);

const MITOSIS = [
  '## Phases of mitosis',
  'A cell divides in four steps, and each one has a job.',
  '- Prophase: the chromosomes coil up and the nuclear envelope breaks down',
  'Metaphase: the chromosomes line up along the middle of the cell',
  'Anaphase: the sister chromatids pull apart',
  'Telophase: two new nuclei form',
  '',
  'Question for Thursday: how does this differ from [[Meiosis]]?',
];

export const scenes: (h: Helpers) => Scene[] = (h) => {
  /** Opens a page, waits for its commands, and types the lines under what is there (a Markdown line each). */
  async function pageWith(p: Page, section: string, title: string, lines: string[]): Promise<void> {
    await h.openPage(p, section, title);
    await commandsReady(p);
    await toEnd(p);
    await keys(p, lines.join('{Enter}'));
  }

  /** Types a short page so ink has something to sit beside, then opens the Draw tab. */
  async function inkPage(p: Page, lines: string[]): Promise<void> {
    await pageWith(p, 'Lectures', 'Membranes', lines);
    await blur(p);
    await h.tab(p, 'Draw');
    await p.locator('[data-ink-overlay]').waitFor({ state: 'attached' });
  }

  /** The top left of the page view, where ink coordinates start. */
  async function origin(p: Page): Promise<{ x: number; y: number }> {
    const box = (await p.locator('[data-ink-overlay]').boundingBox())!;
    return { x: box.x, y: box.y };
  }

  /** Where a piece of the page's text sits, in the ink overlay's pixels. */
  async function textAt(p: Page, text: string | RegExp) {
    const o = await origin(p);
    const b = (await p.getByText(text).first().boundingBox())!;
    return { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height };
  }

  /** Records a few seconds into Membranes with notes typed along the way, and returns the recording block. */
  async function recorded(p: Page) {
    await h.openPage(p, 'Lectures', 'Membranes');
    await commandsReady(p);
    const record = p.getByRole('group', { name: 'Recording', exact: true });
    await record.getByRole('button', { name: 'Record' }).click();
    await p.getByTestId('recording-indicator').waitFor({ timeout: 20_000 });
    await textBox(p).click();
    await keys(p, 'Osmosis moves water across the membrane{Alt+Shift+M}');
    await p.waitForTimeout(3000);
    await keys(p, '{Enter}Water follows the salt{Alt+Shift+M}');
    await p.waitForTimeout(3000);
    await keys(p, '{Enter}Quiz question about tonicity{Alt+Shift+M}');
    await p.waitForTimeout(3000);
    await record.getByRole('button', { name: 'Stop' }).click();
    const block = p.getByRole('group', { name: /^Recording, \d+:\d+$/ });
    await block.waitFor();
    await blur(p);
    return block;
  }

  return [
    {
      name: 'home-screen',
      run: async (p) => {
        await h.typeNotes(p);
        await pagesTree(p).getByRole('treeitem', { name: 'Meiosis' }).click();
        await commandsReady(p);
        await h.write(
          p,
          ['## Meiosis in brief', '[ ] Hand in the lab report Oct 2', 'Study for the midterm Oct 9'],
          'Study for the midterm',
        );
        await blur(p);
        await p.keyboard.press('Control+Shift+KeyF');
        await p.getByRole('combobox', { name: 'Search notes' }).fill('chromosomes');
        await p.locator('strong', { hasText: 'chromosomes' }).first().waitFor();
        await p.getByRole('button', { name: 'Save this search' }).click();
        await p.getByRole('textbox', { name: 'Name for this search' }).fill('Chromosome notes');
        await p.getByRole('button', { name: 'Save', exact: true }).click();
        await p.waitForTimeout(500);
        await p.keyboard.press('Escape');
        await h.command(p, 'Go home', 'Go home');
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'title-bar-states',
      run: async (p) => {
        await h.typeNotes(p);
        await pagesTree(p).getByRole('treeitem', { name: 'Meiosis' }).click();
        await commandsReady(p);
        await h.write(p, ['## Meiosis in brief', 'Meiosis makes four cells with half the chromosomes.'], 'half the chromosomes');
        await blur(p);
        await p.keyboard.press('Alt+ArrowLeft');
        await pagesTree(p).getByRole('treeitem', { name: 'Meiosis' }).click();
        await h.command(p, 'Open timers', 'Open timers');
        const d = p.getByRole('dialog', { name: 'Timers' });
        await d.getByRole('button', { name: 'Add timer' }).click();
        await d.getByRole('button', { name: 'Start' }).click();
        await expect(d.getByText('Running')).toBeVisible();
        await d.getByRole('button', { name: 'Close' }).first().click();
        await d.waitFor({ state: 'detached' });
        await p.keyboard.press('Alt+ArrowLeft');
      },
    },
    {
      name: 'page-tabs',
      run: async (p) => {
        await h.ready(p);
        await notebooks(p).getByRole('treeitem', { name: 'Lectures' }).click();
        for (const title of ['Membranes', 'Meiosis', 'Mitosis']) {
          await pagesTree(p).getByRole('treeitem', { name: title }).click({ button: 'right' });
          await p.getByRole('menuitem', { name: 'Open in new tab' }).click();
        }
        await pagesTree(p).getByRole('treeitem', { name: 'Mitosis' }).click();
        await h.write(p, MITOSIS, 'Question for Thursday');
        await blur(p);
      },
    },
    {
      name: 'compact-layout',
      run: async (p) => {
        await h.typeNotes(p);
        await p.setViewportSize({ width: 400, height: 800 });
        await blur(p);
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'focus-mode',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Focus mode', 'Focus mode');
        await p.getByRole('button', { name: 'Exit focus mode' }).waitFor();
      },
    },
    {
      name: 'quick-capture',
      run: async (p) => {
        await p.addInitScript(() => {
          (window as unknown as { __OPENNOTE_WINDOW__: unknown }).__OPENNOTE_WINDOW__ = { kind: 'capture' };
        });
        await p.setViewportSize({ width: 520, height: 420 });
        await p.reload();
        const box = p.getByRole('textbox', { name: 'Quick note' });
        await box.fill('Buy index cards and a red pen\nEmail the lab group about Thursday');
      },
    },
    {
      name: 'slash-menu',
      run: async (p) => {
        await pageWith(p, 'Lectures', 'Membranes', [
          '## Cell membranes',
          'The membrane controls what enters and leaves the cell.',
          '',
          '/',
        ]);
        await p.getByRole('listbox', { name: 'Insert a block' }).waitFor();
      },
    },
    {
      name: 'formatting-bar',
      run: async (p) => {
        await h.settings(p, 'Editing');
        await p.getByRole('radiogroup', { name: 'Show the formatting bar' }).getByText('Always', { exact: true }).click();
        await p.keyboard.press('Escape');
        await pageWith(p, 'Lectures', 'Membranes', [
          '## Cell membranes',
          'The membrane is a thin double layer of fat molecules.',
          '',
          '',
          'The membrane controls what enters and leaves the cell.',
        ]);
        await p.keyboard.press('Shift+Home');
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'block-callouts',
      run: async (p) => {
        await pageWith(p, 'Lectures', 'Meiosis', [
          '## Meiosis in brief',
          'Meiosis makes four cells with half the chromosomes.',
          '',
          '> [!note] Key idea',
          'Crossing over mixes the genes of the two parents.',
          '',
          '> [!tip] Remember',
          'Meiosis I splits the pairs, and meiosis II splits the copies.',
          '',
          '> [!warning] Common mistake',
          'Mitosis and meiosis are not the same process.',
          '',
        ]);
        await p.waitForTimeout(400);
      },
    },
    {
      name: 'block-code',
      run: async (p) => {
        await pageWith(p, 'Labs', 'Photosynthesis lab', [
          '## Growth rate',
          'The population doubles every hour, so its size after t hours is a power of two.',
          '',
        ]);
        await keys(p, '```python def population(start, hours):{Enter}    return start * 2 ** hours{Enter}{Enter}print(population(100, 3))');
        await p.waitForTimeout(600);
      },
    },
    {
      name: 'code-cell',
      run: async (p) => {
        await pageWith(p, 'Labs', 'Photosynthesis lab', [
          '## Growth rate',
          'Run the cell to see the cell count after each hour.',
          '',
        ]);
        await h.command(p, 'Insert code cell', 'Insert code cell');
        await p.getByRole('textbox', { name: 'Code' }).fill('for hour in range(4):\n    print(hour, 100 * 2 ** hour)');
        await p.getByRole('button', { name: 'Run' }).click();
        await expect(p.getByRole('log', { name: 'Output' })).toContainText('3 800', { timeout: 60_000 });
      },
    },
    {
      name: 'page-templates',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'New page from template', 'New page from template');
        await p.waitForTimeout(600);
      },
    },
    {
      name: 'page-history',
      run: async (p) => {
        await h.openPage(p, 'Lectures', 'Mitosis');
        await commandsReady(p);
        await h.write(p, MITOSIS.slice(0, 3), 'Prophase');
        await pagesTree(p).getByRole('treeitem', { name: 'Meiosis' }).click();
        await pagesTree(p).getByRole('treeitem', { name: 'Mitosis' }).click();
        await commandsReady(p);
        await toEnd(p);
        await keys(p, '{Enter}Metaphase: the chromosomes line up along the middle of the cell{Enter}Anaphase: the sister chromatids pull apart');
        await expect.poll(() => p.evaluate(() => document.body.innerText.includes('Anaphase'))).toBe(true);
        await pagesTree(p).getByRole('treeitem', { name: 'Meiosis' }).click();
        await pagesTree(p).getByRole('treeitem', { name: 'Mitosis' }).click();
        await commandsReady(p);
        await h.command(p, 'Page history', /^Page history/);
        const panel = p.getByRole('region', { name: 'Page history' }).or(p.getByRole('complementary', { name: 'Page history' }));
        await panel.waitFor();
        await panel.getByRole('list', { name: 'Versions' }).getByRole('button').last().click();
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'canvas-view',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'Open the canvas', 'Open the canvas');
        const d = p.getByRole('dialog', { name: 'Canvas' });
        const note = async (text: string) => {
          await d.getByRole('textbox', { name: 'Note text' }).fill(text);
          await d.getByRole('button', { name: 'Add card' }).click();
        };
        await note('Mitosis: two identical cells');
        await note('Meiosis: four cells, half the chromosomes');
        await d.getByRole('combobox', { name: 'Arrow from' }).selectOption({ index: 1 });
        await d.getByRole('combobox', { name: 'Arrow to' }).selectOption({ index: 2 });
        await d.getByRole('button', { name: 'Connect' }).click();
        await p.waitForTimeout(600);
      },
    },
    {
      name: 'writing-tools',
      run: async (p) => {
        const draft = 'the membrane let some things in and keep other things out, which is why its called selectively permeable';
        await pageWith(p, 'Lectures', 'Membranes', ['## Cell membranes', draft]);
        await p.getByText(draft).click({ clickCount: 3 });
        await p.getByText(draft).click({ button: 'right' });
        await p.getByRole('menuitem', { name: /Proofread/ }).click();
        const ask = p.getByRole('dialog', { name: /Turn on/ });
        await ask.waitFor({ timeout: 10_000 });
        await ask.getByRole('button', { name: 'Turn on' }).click();
        await p.waitForTimeout(2000);
      },
    },
    {
      name: 'ink-pen-types',
      viewport: WIDE,
      run: async (p) => {
        const names = ['Fountain pen', 'Brush', 'Calligraphy pen', 'Dashed pen', 'Dotted pen'];
        await inkPage(p, ['## Pen types', ...names]);
        const toolbar = p.getByRole('toolbar', { name: 'Draw' });
        for (const [i, name] of names.entries()) {
          await toolbar.locator('[data-ink-slot]').nth(i).click();
          await toolbar.getByRole('button', { name: 'Width' }).click();
          await p.getByRole('menuitemradio', { name, exact: true }).click();
          const at = await textAt(p, name);
          await draw(p, wavy(at.x + 230, at.y + at.h / 2, 320, 8, 6));
        }
      },
    },
    {
      name: 'ink-eraser',
      viewport: WIDE,
      run: async (p) => {
        await inkPage(p, ['## Cell sketch', 'Label the parts, then erase the mistakes.']);
        const at = await textAt(p, 'Label the parts');
        await choose(p, 'Pen, Ink, 0.5 mm');
        await draw(p, ellipse(at.x + 120, at.y + 150, 90, 55));
        await draw(p, ellipse(at.x + 120, at.y + 150, 28, 20));
        await draw(p, line([at.x + 230, at.y + 120], [at.x + 360, at.y + 90]));
        await draw(p, line([at.x + 230, at.y + 175], [at.x + 360, at.y + 205]));
        await p.getByRole('toolbar', { name: 'Draw' }).getByRole('button', { name: 'Eraser type' }).click();
        await p.getByRole('menu').first().waitFor();
      },
    },
    {
      name: 'ink-lasso',
      viewport: WIDE,
      run: async (p) => {
        await inkPage(p, ['## Notes in ink', 'Circle the ideas to move or recolor them.']);
        const at = await textAt(p, 'Circle the ideas');
        await choose(p, 'Pen, Ink, 0.5 mm');
        await draw(p, wavy(at.x, at.y + 250, 220, 10, 5));
        await draw(p, wavy(at.x, at.y + 300, 260, 10, 6));
        await choose(p, 'Pen, Indigo, 0.5 mm');
        await draw(p, wavy(at.x, at.y + 360, 200, 10, 4));
        await choose(p, 'Lasso select');
        await draw(p, ellipse(at.x + 125, at.y + 275, 190, 60));
        await p.getByRole('toolbar', { name: 'Selected ink and text' }).waitFor();
      },
    },
    {
      name: 'ink-shapes',
      viewport: { width: 1920, height: 1000 },
      run: async (p) => {
        await inkPage(p, ['## Diagram shapes', 'Draw roughly, hold the pen still, and it straightens the shape.']);
        const at = await textAt(p, 'Draw roughly');
        await press(p, 'Ink to shape', true);
        await choose(p, 'Pen, Indigo, 0.5 mm');
        const o = await origin(p);
        const held = async (pts: Point[]) => {
          await p.mouse.move(o.x + pts[0][0], o.y + pts[0][1]);
          await p.mouse.down();
          for (const [x, y] of pts.slice(1)) await p.mouse.move(o.x + x, o.y + y, { steps: 2 });
          await p.waitForTimeout(1300);
          await p.mouse.up();
          await p.waitForTimeout(300);
        };
        const jit = (pts: Point[]): Point[] => pts.map(([x, y], i) => [x + (i % 3), y - (i % 2)]);
        const [x0, y0] = [at.x, at.y + 230];
        const box: Point[] = [
          ...line([x0, y0], [x0 + 170, y0 + 3], 12),
          ...line([x0 + 170, y0 + 3], [x0 + 168, y0 + 100], 12),
          ...line([x0 + 168, y0 + 100], [x0 + 2, y0 + 98], 12),
          ...line([x0 + 2, y0 + 98], [x0 + 1, y0 + 2], 12),
        ];
        const tip: Point = [x0 + 760, y0 + 50];
        const arrow: Point[] = [
          ...line([x0 + 560, y0 + 50], tip, 16),
          ...line(tip, [tip[0] - 45, tip[1] - 27], 8),
          ...line([tip[0] - 45, tip[1] - 27], tip, 8),
          ...line(tip, [tip[0] - 45, tip[1] + 27], 8),
        ];
        await held(jit(box));
        await held(jit(ellipse(x0 + 300, y0 + 50, 60, 52)));
        await held(jit(line([x0 + 400, y0 + 100], [x0 + 500, y0 + 10], 20)));
        await held(arrow);
        await p.getByRole('toolbar', { name: 'Draw' }).getByRole('button', { name: 'Shapes', exact: true }).click();
        await p.getByRole('menuitem', { name: 'Basic shapes' }).click();
        await p.waitForTimeout(500);
      },
    },
    {
      name: 'ink-ruler',
      viewport: WIDE,
      run: async (p) => {
        await inkPage(p, ['## Measuring', 'Lay the ruler on the page and draw along its edge.']);
        await press(p, 'Ruler', true);
        await press(p, 'Protractor', true);
        await p.getByRole('toolbar', { name: 'Draw' }).getByRole('button', { name: 'More commands', exact: true }).click();
        await p.getByRole('menu', { name: 'More commands' }).getByRole('menuitemcheckbox', { name: 'Units: centimeters', exact: true }).click();
        await choose(p, 'Pen, Indigo, 0.5 mm');
        const ruler = p.locator('[data-ink-widget="ruler"]');
        const prot = p.locator('[data-ink-widget="protractor"]');
        const rb = (await ruler.boundingBox())!;
        const pb = (await prot.boundingBox())!;
        // The protractor goes below the ruler, so neither hides the other.
        const from = { x: pb.x + pb.width / 2, y: pb.y + pb.height - 30 };
        await p.mouse.move(from.x, from.y);
        await p.mouse.down();
        await p.mouse.move(from.x, from.y + (rb.y + rb.height - pb.y) + 10, { steps: 8 });
        await p.mouse.up();
        const client = await p.context().newCDPSession(p);
        const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number, buttons: number) =>
          client.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: 'left',
            buttons,
            clickCount: 1,
            pointerType: 'pen',
            force: buttons ? 0.5 : 0,
          });
        const y = rb.y - 5;
        await send('mousePressed', rb.x + 200, y, 1);
        for (let i = 1; i <= 30; i += 1) await send('mouseMoved', rb.x + 200 + i * 10, y + 4 * Math.sin(i), 1);
        await send('mouseReleased', rb.x + 500, y, 0);
        await p.waitForTimeout(500);
      },
    },
    {
      name: 'find-replace',
      run: async (p) => {
        await h.typeNotes(p);
        await p.keyboard.press('Control+KeyH');
        await p.getByRole('textbox', { name: 'Find', exact: true }).fill('chromosomes');
        await p.getByRole('textbox', { name: 'Replace with' }).fill('chromosome pairs');
        await p.waitForTimeout(500);
      },
    },
    {
      name: 'tags-pane',
      run: async (p) => {
        await h.openPage(p, 'Lectures', 'Mitosis');
        await commandsReady(p);
        await h.write(
          p,
          [
            '## Mitosis review',
            'Draw and label the four phases',
            'The spindle fibers pull the chromatids apart',
            'Why do cells need to copy DNA first?',
            'Quiz on Thursday',
          ],
          'Quiz on Thursday',
        );
        const tag = async (text: string, name: string) => {
          await p.getByText(text, { exact: true }).click({ button: 'right' });
          await p.getByRole('menuitem', { name: 'Tag this line' }).click();
          await p.getByRole('menuitem', { name, exact: true }).click();
        };
        await tag('Draw and label the four phases', 'To do');
        await tag('The spindle fibers pull the chromatids apart', 'Important');
        await tag('Why do cells need to copy DNA first?', 'Question');
        await tag('Quiz on Thursday', 'To do');
        await h.command(p, 'Show tagged lines', 'Show tagged lines');
        const tagged = p.getByRole('dialog', { name: 'Tagged lines' });
        await tagged.waitFor();
        await p.waitForTimeout(1500);
        await p.waitForTimeout(500);
      },
    },
    {
      name: 'graph-view',
      run: async (p) => {
        await h.typeNotes(p);
        const linked: [string, string, string[], string][] = [
          ['Lectures', 'Meiosis', ['Compare with [[Mitosis]], and see [[Cell structure]] for the details.'], 'for the details'],
          ['Lectures', 'Membranes', ['The membrane is part of the [[Cell structure]], so read that page too.'], 'read that page too'],
          ['Lectures', 'Photosynthesis', ['Happens in the chloroplast, see [[Cell structure]] for the parts.'], 'for the parts'],
          ['Labs', 'Photosynthesis lab', ['Background: [[Photosynthesis]], then the method below.'], 'method below'],
        ];
        for (const [section, title, lines, saved] of linked) {
          await h.openPage(p, section, title);
          await commandsReady(p);
          await h.write(p, lines, saved);
        }
        await h.command(p, 'Open the graph view', 'Open the graph view');
        const d = p.getByRole('dialog', { name: 'Graph' });
        await d.getByLabel('Show').selectOption({ label: 'This notebook' });
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'collections',
      run: async (p) => {
        const status = async (section: string, title: string, value: string) => {
          await h.openPage(p, section, title);
          await commandsReady(p);
          await p.getByRole('button', { name: /^Properties/ }).click();
          await p.getByRole('combobox', { name: 'Type of field' }).selectOption({ label: 'Choice' });
          await p.getByRole('button', { name: 'Add property' }).click();
          await p.getByRole('textbox', { name: /^Name of this/ }).fill('Status');
          await p.getByRole('textbox', { name: /^Choices for/ }).fill('To review, Reviewing, Reviewed');
          await p.getByRole('combobox', { name: 'Status' }).selectOption({ label: value });
          await p.keyboard.press('Escape');
        };
        await status('Lectures', 'Mitosis', 'Reviewed');
        await status('Lectures', 'Meiosis', 'Reviewing');
        await status('Lectures', 'Membranes', 'Reviewing');
        await status('Lectures', 'Photosynthesis', 'To review');
        await status('Lectures', 'Cell structure', 'Reviewed');
        await h.command(p, 'Open collections', 'Open collections');
        const d = p.getByRole('dialog', { name: 'Collections' });
        await d.getByRole('button', { name: 'New collection' }).click();
        await d.getByRole('textbox', { name: 'Name' }).fill('Lecture review');
        await d.getByRole('button', { name: 'Rules' }).click();
        await d.getByRole('button', { name: 'Board' }).click();
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'recording-block',
      run: async (p) => {
        await recorded(p);
      },
    },
    {
      name: 'transcript-block',
      run: async (p) => {
        const block = await recorded(p);
        await block.getByRole('button', { name: /^More/ }).click();
        await p.getByRole('menuitem', { name: /Add a transcript from text/ }).click();
        const d = p.getByRole('dialog', { name: 'Add a transcript' });
        await d
          .getByRole('textbox', { name: 'Transcript text' })
          .fill(
            [
              '[0:00] Welcome back. Today we look at how water moves across the membrane.',
              '[0:03] Osmosis is the movement of water toward the side with more dissolved solute.',
              '[0:06] So which way does the water move in this beaker?',
              '[0:09] Toward the salty side, until the two sides balance.',
            ].join(NL),
          );
        await d.getByRole('button', { name: 'Add transcript' }).click();
        await p.getByRole('button', { name: 'Edit', exact: true }).click();
        await p.getByLabel('Speaker at 0:00').selectOption('new');
        await p.getByLabel('Speaker at 0:03').selectOption({ label: 'Speaker 1' });
        await p.getByLabel('Speaker at 0:06').selectOption('new');
        await p.getByLabel('Speaker at 0:09').selectOption({ label: 'Speaker 1' });
        await p.getByRole('button', { name: 'Done', exact: true }).click();
        for (const [n, name] of [
          [1, 'Professor'],
          [2, 'Student'],
        ] as const) {
          await p.getByRole('button', { name: `Rename Speaker ${n}` }).click();
          const rename = p.getByRole('dialog', { name: `Rename Speaker ${n}` });
          await rename.getByRole('textbox', { name: 'Name' }).fill(name);
          await rename.getByRole('button', { name: 'Rename', exact: true }).click();
        }
        const toastClose = p.locator('button', { hasText: /^Close$/ });
        while (await toastClose.count()) await toastClose.first().click();
        await p.getByRole('heading', { name: 'Transcript' }).first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
        await p.mouse.move(700, 400);
        await p.mouse.wheel(0, -90);
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'speech-model',
      run: async (p) => {
        await h.settings(p, 'On-device intelligence');
        await p.getByText('Models', { exact: true }).first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
        await p.waitForTimeout(500);
      },
    },
  ];
};
