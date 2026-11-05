// A kit tool's typed values travel in a live calculation block as the form controls of its panel: the Insert button
// reads them, and Open in tool puts them back into the tool, even one that loads late or redraws on a change.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { INSERT_EVENT } from '../flags';
import { applyPanelForm, panelOf, readPanelForm, readSavedPanelForm } from './panelForm';
import { openKitTool, registerKit, resetKits } from './registry';
import { useKitReopen } from './useKitReopen';
import { insertLiveFromPanel } from './ui/insert';

afterEach(() => {
  resetKits();
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

/** A tool the way the kits draw one: controlled fields, a select that changes the fields, and an Insert button. */
function Tool({ tool = 'beam' }: { tool?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState('a');
  const [load, setLoad] = useState('1');
  const [span, setSpan] = useState('2');
  const [fixed, setFixed] = useState(false);
  useKitReopen('demo', tool, panel);
  return (
    <div ref={panel} data-kit-form="demo" data-kit-tool={tool} aria-label="Beam">
      <label>
        Mode
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="a">Simple</option>
          <option value="b">Cantilever</option>
        </select>
      </label>
      <label>
        Load
        <input value={load} onChange={(event) => setLoad(event.target.value)} />
      </label>
      {mode === 'b' ? (
        <label>
          Span
          <input value={span} onChange={(event) => setSpan(event.target.value)} />
        </label>
      ) : null}
      <label>
        Fixed end
        <input type="checkbox" checked={fixed} onChange={(event) => setFixed(event.target.checked)} />
      </label>
      <button type="button">Keep</button>
    </div>
  );
}

describe('panel form', () => {
  it('reads the typed values of a panel by their labels, and puts them back', () => {
    const view = renderUi(<Tool />);
    const panel = view.container.querySelector<HTMLElement>('[data-kit-form]')!;
    fireEvent.change(screen.getByLabelText('Load'), { target: { value: '42' } });
    fireEvent.click(screen.getByLabelText('Fixed end'));
    const form = readPanelForm(panel);
    expect(form?.fields).toEqual([
      { key: 'Mode', at: 0, value: 'a' },
      { key: 'Load', at: 0, value: '42' },
      { key: 'Fixed end', at: 0, value: true },
    ]);
    view.unmount();
    const again = renderUi(<Tool />);
    const fresh = again.container.querySelector<HTMLElement>('[data-kit-form]')!;
    expect((screen.getByLabelText('Load') as HTMLInputElement).value).toBe('1');
    expect(applyPanelForm(fresh, form!)).toBe(2);
    expect((screen.getByLabelText('Load') as HTMLInputElement).value).toBe('42');
    expect((screen.getByLabelText('Fixed end') as HTMLInputElement).checked).toBe(true);
  });

  it('ignores saved inputs that are not a panel form', () => {
    expect(readSavedPanelForm(null)).toBeNull();
    expect(readSavedPanelForm({ texts: {}, system: 'si' })).toBeNull();
    expect(readSavedPanelForm({ panel: 1, fields: [{ key: 1 }] })).toBeNull();
  });

  it('keeps the tool and its title from the panel for the block', () => {
    renderUi(<Tool />);
    const panel = panelOf(screen.getByRole('button', { name: 'Keep' }));
    expect(panel).toMatchObject({ kit: 'demo', tool: 'beam', title: 'Beam' });
  });

  it('takes the title from data-kit-title, because a generic div may not carry an aria-label', () => {
    renderUi(
      <div data-kit-form="demo" data-kit-tool="beam" data-kit-title="Beam tool">
        <button type="button">Keep</button>
      </div>,
    );
    expect(panelOf(screen.getByRole('button', { name: 'Keep' }))?.title).toBe('Beam tool');
  });

  it('makes a live block that Open in tool restores, also through a field that appears after a select changes', async () => {
    const sent: { panel?: { data: { inputs: unknown } } }[] = [];
    const take = (event: Event) => {
      const request = (event as CustomEvent<{ panel?: { data: { inputs: unknown } }; handled: boolean }>).detail;
      sent.push(request);
      request.handled = true;
    };
    window.addEventListener(INSERT_EVENT, take);
    try {
      const view = renderUi(<Tool />);
      fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'b' } });
      fireEvent.change(screen.getByLabelText('Load'), { target: { value: '7' } });
      fireEvent.change(screen.getByLabelText('Span'), { target: { value: '9' } });
      expect(insertLiveFromPanel(screen.getByRole('button', { name: 'Keep' }), { summary: 'R = 3 kN' })).toBe(true);
      const inputs = sent[0].panel!.data.inputs;
      view.unmount();

      // A new window starts on the first mode with the first values; Open in tool brings the saved ones back.
      registerKit('demo', () => undefined);
      renderUi(<Tool />);
      expect((screen.getByLabelText('Load') as HTMLInputElement).value).toBe('1');
      await act(async () => {
        await openKitTool('demo', 'beam', inputs);
      });
      await waitFor(() => {
        expect((screen.getByLabelText('Mode') as HTMLSelectElement).value).toBe('b');
        expect((screen.getByLabelText('Load') as HTMLInputElement).value).toBe('7');
        expect((screen.getByLabelText('Span') as HTMLInputElement).value).toBe('9');
      });
    } finally {
      window.removeEventListener(INSERT_EVENT, take);
    }
  });

  it('does not make a block outside a marked panel', () => {
    renderUi(<button type="button">Alone</button>);
    expect(insertLiveFromPanel(screen.getByRole('button', { name: 'Alone' }), { summary: 'x' })).toBe(false);
  });
});
