// The kit window with the example tool: ARIA tabs, typed inputs that work the problem, words for a bad value, the SI
// and US switch, the Insert menu's choices, and the live calculation block reopening the tool with its inputs.
import { Editor } from '@tiptap/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { textExtensions } from '../../../editor/schema/schema';
import { INSERT_EVENT } from '../flags';
import { KitCalcView } from './block/KitCalcBlock';
import { KIT_CALC_TYPE } from './block/model';
import { EXAMPLE_KIT } from './example/kit';
import { openKitTool, registerKit, resetKits } from './registry';
import type { KitDef } from './types';
import { insertSteps } from './ui/insert';
import { insertActions } from './ui/InsertMenu';
import { KitWindow } from './ui/KitWindow';

afterEach(() => {
  resetKits();
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

const TWO_TOOLS: KitDef = {
  ...EXAMPLE_KIT,
  tools: [...EXAMPLE_KIT.tools, { ...EXAMPLE_KIT.tools[0], id: 'second', title: 'kits.results.title' }],
};

describe('kit window', () => {
  it('works the example problem, explains a bad value, and passes axe in light and dark', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const view = renderUi(<KitWindow kit={EXAMPLE_KIT} />, { theme });
      const table = await screen.findByRole('table');
      // 1 mol at 273.15 K and 101.325 kPa: V = 0.02241 m³, the answer row first.
      expect(within(table).getAllByRole('row')[1].textContent).toContain('0.02241 m³');
      expect(screen.getByRole('region', { name: 'Worked steps' })).toBeTruthy();
      await expectNoAxeViolations(view.container);
      view.unmount();
    }
  });

  it('says what is wrong with a value, and switches to US units', async () => {
    renderUi(<KitWindow kit={EXAMPLE_KIT} />);
    const temperature = await screen.findByRole('textbox', { name: 'Temperature' });
    fireEvent.change(temperature, { target: { value: 'warm' } });
    expect(await screen.findByText('Type a number, such as 2.5 or 1.2e-3.')).toBeTruthy();
    expect(temperature.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(temperature, { target: { value: '273.15' } });
    fireEvent.click(screen.getByRole('radio', { name: 'US customary' }));
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')[1].textContent).toContain('ft³'));
    // 0.022414 m³ is 0.79154 ft³.
    expect(within(table).getAllByRole('row')[1].textContent).toContain('0.7915');
    expect((screen.getByRole('combobox', { name: 'Unit of Pressure' }) as HTMLSelectElement).value).toBe('psi');
  });

  it('moves between tools with arrow keys, Home, and End, and remembers the choice', async () => {
    const view = renderUi(<KitWindow kit={TWO_TOOLS} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getAllByRole('tab')[1]);
    fireEvent.keyDown(screen.getAllByRole('tab')[1], { key: 'Home' });
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'End' });
    view.unmount();
    renderUi(<KitWindow kit={TWO_TOOLS} />);
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getAllByRole('tab')[1].id);
  });

  it('opens on the inputs a live calculation block saved', async () => {
    registerKit('example', () => undefined);
    renderUi(<KitWindow kit={EXAMPLE_KIT} />);
    await screen.findByRole('table');
    const saved = {
      unknown: 'p',
      p: { text: '1', unit: 'kPa' },
      V: { text: '10', unit: 'L' },
      n: { text: '2', unit: 'mol' },
      T: { text: '300', unit: 'K' },
    };
    await act(async () => {
      await openKitTool('example', 'idealGas', saved);
    });
    // p = 2 · 8.314462618 · 300 / 0.010 = 498.9 kPa.
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')[1].textContent).toContain('498.9 kPa'),
    );
  });
});

describe('insert menu and live block', () => {
  it('offers only what a result has, and the live block carries the inputs', () => {
    type Sent = { panel?: { type: string; data: Record<string, unknown> }; handled: boolean };
    const sent: Sent[] = [];
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<Sent>).detail;
      sent.push(detail);
      detail.handled = true;
    };
    expect(insertActions({ content: { answer: 'x = 1' } }).map((a) => a.id)).toEqual(['answer']);
    const actions = insertActions({
      content: { answer: 'x = 1', latex: 'x = 1', rows: [{ id: 'x', label: 'X', value: '1', unit: 'm' }] },
      live: { kit: 'example', tool: 'idealGas', title: 'Ideal gas law', inputs: { unknown: 'V' } },
    });
    expect(actions.map((a) => a.id)).toEqual(['answer', 'equation', 'table', 'live']);
    window.addEventListener(INSERT_EVENT, listen);
    try {
      expect(actions[3].run()).toBe(true);
    } finally {
      window.removeEventListener(INSERT_EVENT, listen);
    }
    // The page inserts a panel block by its full type (features/page/registrations/smart.ts).
    expect(sent[0].panel?.type).toBe(KIT_CALC_TYPE);
    expect(sent[0].panel?.data).toMatchObject({ kit: 'example', tool: 'idealGas', inputs: { unknown: 'V' } });
  });

  it('shows the block’s results and reopens its tool, or says the tool is missing', async () => {
    const opened: string[] = [];
    const said: string[] = [];
    const data = {
      kit: 'example',
      tool: 'idealGas',
      title: 'Ideal gas law',
      summary: 'V = 0.02241 m³',
      inputs: { unknown: 'V' },
      rows: [{ label: 'Volume', value: '0.02241', unit: 'm³' }],
    };
    const view = renderUi(<KitCalcView data={data} announce={(text) => said.push(text)} />);
    expect(screen.getByText('Volume')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in tool' }));
    await waitFor(() => expect(said).toEqual(['The tool for this calculation is not in this version of OpenNote.']));
    registerKit('example', (tool) => void opened.push(tool));
    fireEvent.click(screen.getByRole('button', { name: 'Open in tool' }));
    await waitFor(() => expect(opened).toEqual(['idealGas']));
    await expectNoAxeViolations(view.container);
  });
});

describe('worked steps on a page', () => {
  it('go in as a numbered list whose math renders as math blocks, not raw LaTeX', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = new Editor({ element: host, extensions: textExtensions, content: '<p></p>' });
    // The page's listener (page/registrations/smart.ts) inserts a text request at the caret the same way.
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; handled: boolean }>).detail;
      if (detail.text !== undefined) detail.handled = editor.chain().focus().insertContent(detail.text).run();
    };
    window.addEventListener(INSERT_EVENT, listen);
    try {
      expect(
        insertSteps([
          { key: 'kits.example.step.law', math: 'pV = nRT' },
          { key: 'kits.example.step.result', vars: { value: 'V' }, math: 'V = 0.022414\\,\\mathrm{m^3}' },
        ]),
      ).toBe(true);
      const kinds: string[] = [];
      const sources: string[] = [];
      editor.state.doc.descendants((node) => {
        kinds.push(node.type.name);
        if (node.type.name === 'mathBlock') sources.push(node.attrs.source as string);
      });
      expect(kinds).toContain('orderedList');
      expect(kinds.filter((kind) => kind === 'listItem')).toHaveLength(2);
      expect(sources).toEqual(['pV = nRT', 'V = 0.022414\\,\\mathrm{m^3}']);
      expect(editor.state.doc.textContent).not.toContain('\\');
      expect(host.querySelectorAll('ol li [data-math-block]')).toHaveLength(2);
    } finally {
      window.removeEventListener(INSERT_EVENT, listen);
      editor.destroy();
      host.remove();
    }
  });
});
