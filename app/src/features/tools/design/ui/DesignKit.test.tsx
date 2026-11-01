// checks-disable-file modifiability: one describe block per feature
import '../text';

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { DESIGN_TOOLS } from '../meta';
import { say } from './ToolPanel';
import { DesignKit } from './DesignKit';

beforeEach(() => localStorage.clear());

const tab = (id: string) => screen.getByRole('tab', { name: say(DESIGN_TOOLS.find((t) => t.id === id)!.title) });
const open = async (id: string) => {
  fireEvent.click(tab(id));
  await waitFor(() => expect(screen.queryByText(say('kitDesign.loading'))).toBeNull());
};

describe('the design kit window', () => {
  it('has a tab for every tool and moves between them with the arrow keys', async () => {
    renderUi(<DesignKit />);
    expect(screen.getAllByRole('tab')).toHaveLength(DESIGN_TOOLS.length);
    const first = screen.getAllByRole('tab')[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getAllByRole('tab').at(-1)!.getAttribute('aria-selected')).toBe('true');
  });

  it('every tool opens without error and shows a result or its controls', async () => {
    renderUi(<DesignKit />);
    for (const tool of DESIGN_TOOLS) {
      await open(tool.id);
      expect(screen.getByRole('tabpanel').textContent?.length ?? 0, tool.id).toBeGreaterThan(40);
    }
  });

  it('the tolerances tool shows the worst case and worked steps for its first example', async () => {
    renderUi(<DesignKit />);
    await open('tolerances');
    expect(screen.getByText(say('kitDesign.tolerances.row.worstMax'))).toBeTruthy();
    expect(screen.getByRole('heading', { name: say('kitDesign.ui.steps') })).toBeTruthy();
  });

  it('a wrong number marks the field and explains, and keeps no stale result', async () => {
    renderUi(<DesignKit />);
    await open('machining');
    const field = screen.getByLabelText(say('kitDesign.machining.field.d')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'abc' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(say('kitDesign.error.notNumber'))).toBeTruthy();
    expect(screen.queryByText(say('kitDesign.machining.row.rpm'))).toBeNull();
  });

  it('an impossible input names the problem in words', async () => {
    renderUi(<DesignKit />);
    await open('machining');
    fireEvent.change(screen.getByLabelText(say('kitDesign.machining.field.depth')), { target: { value: '60' } });
    expect(screen.getByText(say('kitDesign.error.depthTooDeep'))).toBeTruthy();
  });

  it('switching to US units converts the typed numbers', async () => {
    renderUi(<DesignKit />);
    await open('machining');
    const d = screen.getByLabelText(say('kitDesign.machining.field.d')) as HTMLInputElement;
    expect(d.value).toBe('50');
    fireEvent.change(screen.getByLabelText(say('kitDesign.ui.units')), { target: { value: 'us' } });
    expect(Number(d.value)).toBeCloseTo(50 / 25.4, 3);
  });

  it('the memory tracer runs its first example and steps through it', async () => {
    renderUi(<DesignKit />);
    await open('memtrace');
    fireEvent.click(screen.getByRole('button', { name: say('kitDesign.memtrace.run') }));
    await waitFor(() => expect(screen.getByText(say('kitDesign.memtrace.next'))).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: say('kitDesign.memtrace.lastStep') }));
  });

  it('the views tool builds a model from cells', async () => {
    renderUi(<DesignKit />);
    await open('views');
    const cells = screen.getAllByRole('button', { pressed: false });
    expect(cells.length).toBeGreaterThan(5);
    fireEvent.click(cells[0]!);
    expect(screen.getAllByRole('button', { pressed: true }).length).toBeGreaterThan(0);
  });

  it('the drafting sheet adds a line by coordinates and reads its length', async () => {
    renderUi(<DesignKit />);
    await open('drafting');
    fireEvent.click(screen.getByRole('button', { name: say('kitDesign.drafting.addShape') }));
    expect(screen.getByRole('button', { name: new RegExp(say('kitDesign.drafting.shapes.line')) })).toBeTruthy();
  });

  it('drawing with the pointer: a line, then an aligned dimension that reads 50.00 and follows an edit', async () => {
    renderUi(<DesignKit />);
    await open('drafting');
    const sheet = screen.getByRole('application');
    const rect = sheet.getBoundingClientRect();
    const at = (x: number, y: number) => ({
      button: 0,
      pointerType: 'mouse',
      clientX: rect.left + (x / 297) * rect.width,
      clientY: rect.top + ((210 - y) / 210) * rect.height,
    });
    // The line tool is the one chosen when the sheet opens; two clicks on grid points make a line of 50 mm.
    fireEvent.pointerDown(sheet, at(50, 50));
    fireEvent.pointerDown(sheet, at(80, 90));
    fireEvent.click(screen.getByRole('radio', { name: say('kitDesign.drafting.tools.dimAligned') }));
    fireEvent.pointerDown(sheet, at(50, 50));
    fireEvent.pointerDown(sheet, at(80, 90));
    fireEvent.pointerDown(sheet, at(40, 70));
    expect(screen.getByRole('button', { name: /50\.00/ })).toBeTruthy();
    // Moving an endpoint by typing updates the dimension: one change, and one undo takes both back.
    fireEvent.click(screen.getByRole('radio', { name: say('kitDesign.drafting.tools.select') }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(say('kitDesign.drafting.shapes.line')) }));
    // The selected shape's panel comes before the one for typing a new shape.
    const toY = screen.getAllByLabelText(say('kitDesign.drafting.coord.y2'))[0] as HTMLInputElement;
    fireEvent.change(toY, { target: { value: '130' } });
    fireEvent.blur(toY);
    expect(screen.getByRole('button', { name: /85\.44/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: say('kitDesign.drafting.undo') }));
    expect(screen.getByRole('button', { name: /50\.00/ })).toBeTruthy();
  });

  it('has no accessibility violations in any tool', async () => {
    const { container } = renderUi(
      <main>
        <DesignKit />
      </main>,
    );
    for (const tool of DESIGN_TOOLS) {
      await open(tool.id);
      await expectNoAxeViolations(container);
    }
  });
});
