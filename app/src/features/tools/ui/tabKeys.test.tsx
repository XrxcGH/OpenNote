// The tab lists of the chemistry calculators, the property tables, and the reference tables move with the arrow keys,
// Home, and End, and only the open tab is in the Tab order (full walk 2, chemistry calculators).
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test';
import { ChemCalcTool } from './ChemCalcTool';
import { PropertiesTool } from './PropertiesTool';
import { ReferenceTool } from './ReferenceTool';
import { tabTarget } from './tabKeys';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const lists: readonly (readonly [string, () => ReactElement])[] = [
  ['chemistry calculators', () => <ChemCalcTool />],
  ['property tables', () => <PropertiesTool />],
  ['reference tables', () => <ReferenceTool />],
];

describe('tab lists in the tool windows', () => {
  for (const [name, tool] of lists) {
    it(`move with the keys in the ${name}`, async () => {
      renderUi(tool());
      const tabs = screen.getAllByRole('tab');
      const selected = () => screen.getByRole('tab', { selected: true });
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([selected()]);
      selected().focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(selected());
      await userEvent.keyboard('{End}');
      expect(selected()).toBe(tabs.at(-1));
      expect(document.activeElement).toBe(tabs.at(-1));
      await userEvent.keyboard('{ArrowRight}');
      expect(selected()).toBe(tabs[0]);
      await userEvent.keyboard('{ArrowLeft}');
      expect(selected()).toBe(tabs.at(-1));
      await userEvent.keyboard('{Home}');
      expect(selected()).toBe(tabs[0]);
    });
  }

  it('names the tab a key goes to', () => {
    expect(tabTarget('ArrowRight', 2, 3)).toBe(0);
    expect(tabTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(tabTarget('x', 0, 3)).toBe(-1);
  });
});
