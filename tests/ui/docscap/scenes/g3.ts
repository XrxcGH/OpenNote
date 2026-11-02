// Capture scenes of group g3 (see docs/tools/screens.json for the names, categories, and captions).
// Each one opens the real kit window from the palette over a typed page, picks a tool, and shows a worked example.
import type { Locator, Page } from '@playwright/test';
import type { Helpers, Scene } from '../more';

interface Kit {
  /** What the palette needs: the command title. */
  command: string | RegExp;
  /** What to type in the palette when the command is a pattern. */
  query?: string;
  /** The window's accessible name. */
  window: string;
  /** A tab to click, when the kit uses tabs. */
  tab?: string;
  /** Options to pick in the window's lists, in order (the Tool or Topic list, then the Calculation list). */
  pick?: string[];
  /** Runs once the tool shows, to fill in a worked example. */
  after?: (d: Locator, p: Page) => Promise<void>;
  /** Scrolls the window so this element is at the top, to show the results and the picture below the form. */
  scroll?: (d: Locator) => Locator;
}

const ABC = ['X:1', 'T:Twinkle', 'M:4/4', 'L:1/4', 'Q:1/4=100', 'K:C', 'CCGG|AAG2|FFEE|DDC2|'].join(
  String.fromCharCode(10),
);

export const scenes: (h: Helpers) => Scene[] = (h) => {
  const results = (d: Locator) => d.getByText('Results', { exact: true });
  const kit = (name: string, k: Kit, viewport?: Scene['viewport']): Scene => ({
    name,
    viewport: process.env.G3_TALL ? { width: 1280, height: 2600 } : viewport,
    run: async (p) => {
      await h.typeNotes(p);
      await h.command(p, k.query ?? String(k.command), k.command);
      const d = p.getByRole('dialog', { name: k.window, exact: true });
      await d.waitFor({ timeout: 20_000 });
      await p.waitForTimeout(1500);
      if (k.tab) await d.getByRole('tab', { name: k.tab, exact: true }).click();
      for (const [i, option] of (k.pick ?? []).entries()) {
        await d.locator('select').nth(i).selectOption({ label: option });
        await p.waitForTimeout(600);
      }
      await k.after?.(d, p);
      if (k.scroll)
        await k
          .scroll(d)
          .first()
          .evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await p.waitForTimeout(800);
    },
  });

  return [
    kit('kit-thermo', { command: 'Open the thermodynamics kit', window: 'Thermodynamics kit', tab: 'Steam' }),
    kit('kit-thermo-cycles', {
      command: 'Open the thermodynamics kit',
      window: 'Thermodynamics kit',
      tab: 'Cycles',
      after: async (d, p) => {
        await d.getByLabel('Turbine isentropic efficiency').fill('85');
        await d.getByLabel('Pump isentropic efficiency').fill('80');
        await p.waitForTimeout(800);
      },
      scroll: results,
    }),
    kit('kit-fluid-heat', {
      command: 'Open the fluid mechanics and heat transfer tools',
      window: 'Fluids and heat transfer',
      tab: 'Pipe flow and pumps',
      scroll: results,
    }),
    kit('kit-aerospace', { command: 'Open the aerospace tools', window: 'Aerospace', tab: 'Atmosphere' }),
    kit('kit-solids-fem', {
      command: 'Open the solid mechanics tools',
      window: 'Solid mechanics',
      tab: 'Finite element workbench',
      after: async (d, p) => {
        await d.getByLabel('Problem').selectOption({ label: 'Plate in plane stress' });
        await p.waitForTimeout(500);
        await d
          .locator('select')
          .filter({ has: p.locator('option', { hasText: 'Clamped' }) })
          .selectOption({ label: 'Clamped' });
        await d
          .locator('select')
          .filter({ has: p.locator('option', { hasText: 'Shear force' }) })
          .selectOption({ label: 'Shear force' });
        await p.waitForTimeout(1500);
      },
      scroll: (d) => d.getByRole('img').first(),
    }),
    kit('kit-mechanisms', {
      command: 'Open the mechanisms and dynamics kit',
      window: 'Mechanisms and dynamics',
      tab: 'Linkages',
      scroll: (d) => d.getByText('Toggle positions of the output'),
    }),
    kit('kit-control', {
      command: 'Open the dynamics and control tools',
      window: 'Dynamics and control',
      tab: 'Bode and Nyquist',
      scroll: (d) => d.getByRole('row', { name: /^Gain crossover/ }),
    }),
    kit(
      'kit-circuits',
      {
        command: 'Open the circuits and energy tools',
        window: 'Circuits and energy',
        tab: 'Simulator',
      },
      { width: 1280, height: 1560 },
    ),
    kit('kit-engineering-math', {
      command: 'Open the engineering mathematics tools',
      window: 'Engineering mathematics',
      tab: 'Linear algebra workbench',
    }),
    kit('kit-civil', {
      command: /^Civil and chemical engineering$/,
      query: 'civil and chem',
      window: 'Civil and chemical engineering',
      pick: ['Hydrology and open channels'],
    }),
    kit('kit-design', {
      command: 'Open the design tools',
      window: 'Design tools',
      tab: 'Drafting sheet',
      after: async (d, p) => {
        const field = (label: string, value: string) => d.getByLabel(label, { exact: true }).first().fill(value);
        await field('Title', 'Bracket, 6 mm plate');
        await field('Drawn by', 'A. Rivera');
        await field('Date', '2026-09-30');
        await field('Material', 'Aluminum 6061');
        const add = async (shape: string, values: Record<string, string>) => {
          await d
            .locator('select')
            .filter({ has: p.locator('option', { hasText: 'Rectangle' }) })
            .selectOption({ label: shape });
          for (const [label, value] of Object.entries(values)) await field(label, value);
          await d.getByRole('button', { name: 'Add the shape' }).click();
          await p.waitForTimeout(300);
        };
        await add('Rectangle', { 'From x': '60', 'From y': '50', 'To x': '200', 'To y': '150' });
        await add('Circle', { 'Center x': '95', 'Center y': '100', Radius: '18' });
        await add('Circle', { 'Center x': '165', 'Center y': '100', Radius: '18' });
        await add('Line', { 'From x': '40', 'From y': '100', 'To x': '220', 'To y': '100' });
      },
      scroll: (d) => d.getByText(/^(Click the start of the line|Click one corner)/),
    }),
    kit('kit-design-code', {
      command: 'Open the design tools',
      window: 'Design tools',
      tab: 'Memory and pointer tracer',
      after: async (d, p) => {
        await d.getByRole('button', { name: 'Run and trace' }).click();
        const next = d.getByRole('button', { name: 'Next step' });
        await next.waitFor();
        for (let i = 0; i < 3; i += 1) await next.click();
        await p.waitForTimeout(500);
      },
    }),
    kit('kit-signals', {
      command: 'Open signals and sound tools',
      window: 'Signals and sound',
      pick: ['Spectrum analyzer'],
      scroll: (d) => d.getByText(/^Largest peak/),
    }),
    kit('kit-physics', {
      command: 'Open physics tools',
      window: 'Physics tools',
      pick: ['Electric and magnetic fields'],
      scroll: (d) => d.getByText('Assumptions and checks'),
    }),
    kit('kit-modern-physics', {
      command: 'Open the modern physics and astronomy tools',
      window: 'Modern physics and astronomy',
      pick: ['Quantum wells, barriers, and wave packets'],
    }),
    kit('kit-chemistry', {
      command: 'Open the chemistry calculators',
      query: 'chemistry calc',
      window: 'Chemistry calculators',
    }),
    kit(
      'kit-chemistry-structure',
      {
        command: 'Open the chemical structure drawer',
        query: 'chemical structure',
        window: 'Chemical structures',
        after: async (d) => {
          await d.getByLabel('Structure as SMILES text').fill('CC(=O)Oc1ccccc1C(=O)O');
          await d.getByRole('img', { name: /Skeletal formula/ }).waitFor();
          await d.getByLabel('Structure as SMILES text').blur();
        },
      },
      { width: 1280, height: 900 },
    ),
    kit(
      'kit-chemmat',
      {
        command: 'Open the chemical equilibrium tool',
        window: 'Chemistry and materials',
        scroll: (d) => d.getByText('Equilibrium constant K', { exact: true }),
      },
      { width: 1280, height: 900 },
    ),
    kit('kit-earth', {
      command: 'Open the earth sciences kit',
      window: 'Earth sciences',
      pick: ['Atmospheric thermodynamics and soundings', 'Skew-T sounding'],
      scroll: (d) => d.getByRole('row', { name: /^CAPE/ }),
    }),
    kit('kit-life-science', { command: 'Open life science tools', window: 'Life science tools', tab: 'Populations' }),
    kit('kit-biology', { command: 'Open the biology tools', window: 'Biology tools', tab: 'Sequences' }),
    kit('kit-statistics', {
      command: 'Open the statistics kit',
      window: 'Statistics: inference and design',
      tab: 'Describe',
    }),
    kit('kit-stat-models', {
      command: 'Open the statistical models tools',
      window: 'Statistical models',
      tab: 'Linear regression',
      scroll: results,
    }),
    kit('kit-psychology', {
      command: 'Open the psychology and behavior tools',
      window: 'Psychology and behavior',
      tab: 'Signal detection',
      scroll: results,
    }),
    kit('kit-reasoning', { command: 'Open the reasoning kit', window: 'Reasoning kit', tab: 'Logic' }),
    kit('kit-economics', {
      command: 'Open economics and finance tools',
      window: 'Economics and finance',
      pick: ['Markets and welfare'],
      scroll: (d) => d.getByText(/^Price 30/),
    }),
    kit('kit-humanities', {
      command: 'Open the history, places, languages, and texts kit',
      window: 'History, places, languages, and texts',
      tab: 'Map maker',
      scroll: (d) => d.getByRole('img').last(),
    }),
    kit('kit-music', {
      command: 'Open the music, script, camera, and studio tools',
      window: 'Music, script, camera, and studio tools',
      tab: 'Theory',
    }),
    {
      name: 'kit-music-score',
      run: async (p) => {
        await h.typeNotes(p);
        await p.keyboard.press('Enter');
        await h.command(
          p,
          'Open the music, script, camera, and studio tools',
          'Open the music, script, camera, and studio tools',
        );
        const d = p.getByRole('dialog', { name: 'Music, script, camera, and studio tools', exact: true });
        await d.waitFor({ timeout: 20_000 });
        await d.getByRole('tab', { name: 'Score', exact: true }).click();
        await d.getByLabel('Music in ABC notation').fill(ABC);
        await p.waitForTimeout(1500);
        await d.getByRole('img', { name: 'Twinkle' }).first().evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await p.waitForTimeout(800);
      },
    },
  ];
};
