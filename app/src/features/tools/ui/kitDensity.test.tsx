/* eslint-disable opennote/feature-boundaries -- The kits' windows are what this checks; each renders as the tool layer would. */
// Kit windows follow the density setting: in touch density their tabs, selects, and number fields are at least a
// finger target tall, as the rest of the app's controls are (full walk 2, kit touch sizes).
import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { KitAeroTool } from '../../engineering/aero/ui/KitAeroTool';
import { KitElectricalTool } from '../../engineering/electrical/KitElectricalTool';
import { FluidHeatKit } from '../../engineering/fluidheat/ui/FluidHeatKit';
import { SolidsKit } from '../../engineering/solids/ui/SolidsKit';
import { ThermoKit } from '../../engineering/thermo/ui/ThermoKit';
import { renderUi } from '../../../test';
import { MindKit } from '../mind/ui/MindKit';
import { KitMolBioTool } from '../molbio/KitMolBioTool';
import { StatModelsKit } from '../statmodels/ui/StatModelsKit';

const TARGET = 44;

afterEach(() => {
  document.documentElement.removeAttribute('data-density');
});

const kits: readonly (readonly [string, () => ReactElement])[] = [
  ['Aerospace', () => <KitAeroTool />],
  ['Circuits and energy', () => <KitElectricalTool />],
  ['Fluid and heat', () => <FluidHeatKit />],
  ['Solids', () => <SolidsKit />],
  ['Thermodynamics', () => <ThermoKit />],
  ['Mind', () => <MindKit />],
  ['Molecular biology', () => <KitMolBioTool />],
  ['Statistical models', () => <StatModelsKit />],
];

describe('kit windows in touch density', () => {
  for (const [name, kit] of kits) {
    it(`give the ${name} kit's tabs a finger-sized target`, async () => {
      renderUi(kit(), { density: 'touch' });
      await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(1));
      for (const tab of screen.getAllByRole('tab')) {
        expect(tab.getBoundingClientRect().height, tab.textContent ?? '').toBeGreaterThanOrEqual(TARGET - 0.5);
      }
    });
    it(`give the ${name} kit's selects and fields a finger-sized target`, async () => {
      const { container } = renderUi(kit(), { density: 'touch' });
      await waitFor(() => expect(container.querySelectorAll('select, input').length).toBeGreaterThan(0));
      const short = [
        ...container.querySelectorAll<HTMLElement>(
          'select, input:not([type=checkbox], [type=radio], [type=range], [type=hidden])',
        ),
      ]
        .filter((field) => field.getClientRects().length > 0)
        .filter((field) => field.getBoundingClientRect().height < TARGET - 0.5)
        .map((field) => {
          const height = Math.round(field.getBoundingClientRect().height);
          return `${field.tagName} ${field.getAttribute('aria-label') ?? field.id} ${height}`;
        });
      expect(short).toEqual([]);
    });
  }
});
