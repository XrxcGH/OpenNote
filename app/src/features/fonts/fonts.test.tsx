// The font box, size box, weight list, and substitution table in a real browser: type-ahead, the size message,
// the open list's paint time with 1,000 fonts, and axe in both themes.
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FontFamily } from '../../platform/types';
import { FAKE_FONTS } from '../../platform/web/fonts';
import { expectNoAxeViolations, renderUi } from '../../test';
import { FontPicker } from './FontPicker';
import { FontSubstitutions } from './FontSubstitutions';
import { recentFonts } from './recent';
import { createCatalog } from './service';
import { useFontCatalog } from './useFontCatalog';
import { SizeBox } from './SizeBox';
import { WeightPicker } from './WeightPicker';

const base = FAKE_FONTS[0].faces[0];

function many(count: number): FontFamily[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Family ${String(i).padStart(4, '0')}`,
    generic: 'sans-serif' as const,
    monospace: false,
    faces: [base],
  }));
}

const NAMED = createCatalog({
  families: ['Arial', 'Georgia', 'Times New Roman', 'Verdana'].map((name) => ({ ...many(1)[0], name })),
});
const box = () => screen.getByRole('combobox', { name: 'Font' });

describe('the font box, odd names and mixed fonts', () => {
  it('renders a font named Constructor without throwing', () => {
    renderUi(<FontPicker catalog={NAMED} value="Constructor" onPick={() => undefined} />);
    expect((box() as HTMLInputElement).value).toBe('Constructor');
  });

  it('shows a placeholder when the selection mixes fonts', () => {
    renderUi(<FontPicker catalog={NAMED} value={null} onPick={() => undefined} />);
    expect(box().getAttribute('placeholder')).toBe('Mixed fonts');
  });
});

describe('the font box', () => {
  beforeEach(() => {
    localStorage.clear();
    recentFonts.set([]);
  });

  it('type-ahead "Times" highlights Times New Roman, and an arrow move then Enter picks it', () => {
    const onPick = vi.fn();
    renderUi(<FontPicker catalog={NAMED} value="Arial" onPick={onPick} />);
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: 'Times' } });
    const active = document.getElementById(box().getAttribute('aria-activedescendant') ?? '');
    expect(active?.textContent).toBe('Times New Roman');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('Times New Roman');
  });

  it('Enter keeps a typed prefix instead of the suggested row, and matches a full name without case', () => {
    const onPick = vi.fn();
    renderUi(<FontPicker catalog={NAMED} value="Arial" onPick={onPick} />);
    fireEvent.change(box(), { target: { value: 'Times' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPick).toHaveBeenLastCalledWith('Times');
    fireEvent.change(box(), { target: { value: 'georgia' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPick).toHaveBeenLastCalledWith('Georgia');
  });

  it('a typed "Segoe UI Semibold" shows the family with no notice, and Enter reports family and weight 600', () => {
    const segoe: FontFamily = {
      ...many(1)[0],
      name: 'Segoe UI',
      faces: [400, 600].map((weight) => ({ ...base, weight })),
    };
    const catalog = createCatalog({ families: [segoe] });
    const onPick = vi.fn();
    const { unmount } = renderUi(<FontPicker catalog={catalog} value="Segoe UI Semibold" onPick={onPick} />);
    expect((box() as HTMLInputElement).value).toBe('Segoe UI');
    expect(screen.queryByText(/not installed/)).toBeNull();
    expect(box().style.fontFamily).toContain('Segoe UI');
    unmount();
    renderUi(<FontPicker catalog={catalog} value="Arial" onPick={onPick} />);
    fireEvent.change(box(), { target: { value: 'Segoe UI Semibold' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('Segoe UI', 600);
  });
});

describe('the font box, bundled and recent fonts', () => {
  beforeEach(() => {
    localStorage.clear();
    recentFonts.set([]);
  });

  it('lists a bundled family in All with an empty device list', () => {
    renderUi(<FontPicker catalog={createCatalog({ families: [] })} value="Carlito" onPick={vi.fn()} />);
    fireEvent.change(box(), { target: { value: 'Litera' } });
    expect(document.getElementById(box().getAttribute('aria-activedescendant') ?? '')?.textContent).toBe('Literata');
  });

  it('picking Georgia puts it first under Recent when the list opens again', async () => {
    function Harness() {
      const catalog = useFontCatalog({ list: () => Promise.resolve(NAMED.families) });
      return <FontPicker catalog={catalog} value="Arial" onPick={vi.fn()} />;
    }
    renderUi(<Harness />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(screen.queryByRole('group', { name: 'Recent fonts' })).toBeNull();
    fireEvent.change(box(), { target: { value: 'Georgia' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const recent = await screen.findByRole('group', { name: 'Recent fonts' });
    expect(recent.querySelector('[role="option"]')?.textContent).toBe('Georgia');
  });

  it('gives option ids without spaces, counts only option rows, and groups the sections', () => {
    renderUi(<FontPicker catalog={createCatalog({ families: [] })} value="Carlito" onPick={vi.fn()} />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const options = [...screen.getAllByRole('option')];
    for (const one of options) expect(one.id).not.toMatch(/\s/);
    expect(new Set(options.map((one) => one.id)).size).toBe(options.length);
    expect(options[0].getAttribute('aria-posinset')).toBe('1');
    const total = Number(options[0].getAttribute('aria-setsize'));
    expect(total).toBe(3 + 5);
    expect(screen.getByRole('group', { name: 'Theme fonts' })).toBeTruthy();
  });

  it('keeps a typed name the device lacks, and refuses a bad one', () => {
    const onPick = vi.fn();
    renderUi(<FontPicker catalog={NAMED} value="Arial" onPick={onPick} />);
    fireEvent.change(box(), { target: { value: 'Aptos' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('Aptos');
    fireEvent.change(box(), { target: { value: 'x"; display: none' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('Enter a font name');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('shows the notice for a missing font, and is blank for a mixed selection', () => {
    const { unmount } = renderUi(<FontPicker catalog={NAMED} value="Calibri" onPick={vi.fn()} />);
    expect(screen.getByText('(not installed: showing Carlito)')).toBeTruthy();
    expect((box() as HTMLInputElement).value).toBe('Calibri');
    expect(box().getAttribute('aria-describedby')).not.toBeNull();
    unmount();
    renderUi(<FontPicker catalog={NAMED} value={null} onPick={vi.fn()} />);
    expect((box() as HTMLInputElement).value).toBe('');
  });
});

describe('the font box, the open list', () => {
  beforeEach(() => {
    localStorage.clear();
    recentFonts.set([]);
  });

  it('opens a 1,000-font list in under 50 ms and draws only the rows in view', () => {
    const catalog = createCatalog({ families: many(1000) });
    renderUi(<FontPicker catalog={catalog} value="Family 0000" onPick={vi.fn()} />);
    const started = performance.now();
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const list = screen.getByRole('listbox', { name: 'Fonts' });
    const elapsed = performance.now() - started;
    expect(list.querySelectorAll('[role="option"]').length).toBeLessThan(30);
    expect(list.querySelector('[role="option"]')?.getAttribute('aria-setsize')).toBe('1008');
    expect(elapsed).toBeLessThan(50);
  });

  it('draws each visible name in its own face', () => {
    renderUi(<FontPicker catalog={NAMED} value="Arial" onPick={vi.fn()} />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const georgia = screen.getByRole('option', { name: 'Georgia' });
    expect(georgia.style.fontFamily).toContain('Georgia');
  });

  it('has no axe violations with an active descendant after type-ahead', async () => {
    const { container } = renderUi(<FontPicker catalog={NAMED} value="Arial" onPick={vi.fn()} />);
    fireEvent.change(box(), { target: { value: 'Ver' } });
    expect(box().getAttribute('aria-activedescendant')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`has no axe violations when open, in the ${theme} theme`, async () => {
      const { container } = renderUi(<FontPicker catalog={NAMED} value="Calibri" onPick={vi.fn()} />, { theme });
      fireEvent.keyDown(box(), { key: 'ArrowDown' });
      expect(box().getAttribute('aria-expanded')).toBe('true');
      await expectNoAxeViolations(container);
    });
  }
});

describe('the size box', () => {
  function Harness({ onCommit }: { onCommit(points: number): void }) {
    const [value, setValue] = useState<number | null>(11);
    return (
      <SizeBox
        value={value}
        onCommit={(points) => {
          setValue(points);
          onCommit(points);
        }}
      />
    );
  }
  const size = () => screen.getByRole('combobox', { name: 'Font size' });

  it.each([
    ['12pt', 12],
    ['1in', 72],
    ['16px', 12],
    ['10.5', 10.5],
  ])('commits %s as %s points', (typed, points) => {
    const onCommit = vi.fn();
    renderUi(<Harness onCommit={onCommit} />);
    fireEvent.change(size(), { target: { value: typed } });
    fireEvent.keyDown(size(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(points);
  });

  it('commits the typed size, not a stale list highlight', () => {
    const onCommit = vi.fn();
    renderUi(<Harness onCommit={onCommit} />);
    fireEvent.keyDown(size(), { key: 'ArrowDown' });
    fireEvent.keyDown(size(), { key: 'ArrowDown' });
    fireEvent.change(size(), { target: { value: '15' } });
    fireEvent.keyDown(size(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(15);
  });

  it.each(['0', '1639'])('refuses %s with the range message', (typed) => {
    const onCommit = vi.fn();
    renderUi(<Harness onCommit={onCommit} />);
    fireEvent.change(size(), { target: { value: typed } });
    fireEvent.keyDown(size(), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('The number must be between 1 and 1638.');
    expect(size().getAttribute('aria-invalid')).toBe('true');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('drops a bad entry on blur, so a later value shows', () => {
    const { rerender } = renderUi(<SizeBox value={11} onCommit={vi.fn()} />);
    fireEvent.change(size(), { target: { value: '99999' } });
    fireEvent.keyDown(size(), { key: 'Enter' });
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.blur(size());
    expect(screen.queryByRole('alert')).toBeNull();
    expect((size() as HTMLInputElement).value).toBe('11');
    rerender(<SizeBox value={14} onCommit={vi.fn()} />);
    expect((size() as HTMLInputElement).value).toBe('14');
  });

  it('chooses from the list with arrows and Enter, and Escape goes back', () => {
    const onCommit = vi.fn();
    renderUi(<Harness onCommit={onCommit} />);
    fireEvent.keyDown(size(), { key: 'ArrowDown' }); // Opens on 11.
    fireEvent.keyDown(size(), { key: 'ArrowDown' });
    fireEvent.keyDown(size(), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(12);
    fireEvent.change(size(), { target: { value: '99' } });
    fireEvent.keyDown(size(), { key: 'Escape' });
    expect((size() as HTMLInputElement).value).toBe('12');
  });

  it('is blank for a mixed selection and has no axe violations', async () => {
    const { container } = renderUi(<SizeBox value={null} onCommit={vi.fn()} />);
    expect((size() as HTMLInputElement).value).toBe('');
    fireEvent.click(size());
    await expectNoAxeViolations(container);
  });
});

describe('the weight list', () => {
  it('a family with faces 300, 400, 600, and 700 lists them, and Semibold sets 600', () => {
    const onPick = vi.fn();
    const fake: FontFamily = {
      ...many(1)[0],
      faces: [300, 400, 600, 700].map((weight) => ({ ...base, weight })),
    };
    renderUi(<WeightPicker family={fake} weight={400} onPick={onPick} />);
    const select = screen.getByRole('combobox', { name: 'Font weight' });
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Light',
      'Regular',
      'Semibold',
      'Bold',
    ]);
    fireEvent.change(select, { target: { value: '600' } });
    expect(onPick).toHaveBeenCalledWith(600);
  });
});

describe('the substitution table', () => {
  it('lists only the missing fonts, with the automatic stand-in named', async () => {
    const { container } = renderUi(<FontSubstitutions catalog={NAMED} used={['Arial', 'Calibri', 'Aptos', '+body']} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    const calibri = screen.getByRole('combobox', { name: 'Shown as, for Calibri' });
    expect(calibri.querySelector('option')?.textContent).toBe('Automatic (Carlito)');
    const aptos = screen.getByRole('combobox', { name: 'Shown as, for Aptos' });
    expect(aptos.querySelector('option')?.textContent).toBe('Automatic (OpenNote Sans)');
    await expectNoAxeViolations(container);
  });
});
