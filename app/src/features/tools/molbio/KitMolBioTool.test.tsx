// The molecular biology window: tabs, a live answer, a problem in words, Insert into the page, and accessibility.
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { INSERT_EVENT } from '../flags';
import { KitMolBioTool } from './KitMolBioTool';

const inserted: { text?: string; picture?: unknown; table?: unknown }[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; picture?: unknown; handled: boolean }>).detail;
  inserted.push(detail);
  detail.handled = true;
};
beforeEach(() => window.addEventListener(INSERT_EVENT, listen));
afterEach(() => {
  window.removeEventListener(INSERT_EVENT, listen);
  inserted.splice(0);
  localStorage.clear();
});

describe('the molecular biology window', () => {
  it('shows the worked example, inserts the answer, and says what is wrong with an input', async () => {
    const { container } = renderUi(<KitMolBioTool />);
    expect(await screen.findByText('Reverse complement: CTATCGGGCACCCTTTCAGCGGCCCATTACAATGGCCAT')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sequences' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Insert answer' }));
    expect(inserted[0]?.text).toContain('CTATCGGG');
    await userEvent.fill(screen.getByLabelText('Sequence'), 'ACGTZ');
    expect((await screen.findByRole('alert')).textContent).toContain('“Z” at position 5');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to the example' }));
    await expectNoAxeViolations(container);
  });

  it('draws the ORF map and inserts it as an SVG picture', async () => {
    renderUi(<KitMolBioTool />);
    await userEvent.selectOptions(await screen.findByLabelText('What to do'), 'orfs');
    expect(await screen.findByRole('img', { name: 'ORF map' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert ORF map' }));
    expect(inserted.at(-1)?.picture).toMatchObject({ mime: 'image/svg+xml', alt: 'ORF map' });
  });

  it('works a dihybrid cross and inserts its Punnett square as a table', async () => {
    const { container } = renderUi(<KitMolBioTool />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crosses' }));
    expect(await screen.findByText('P(aabb) = 1/16; phenotype ratio 9:3:3:1')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert Punnett square' }));
    expect(inserted.at(-1)?.table).toMatchObject({ header: expect.arrayContaining(['AB (1/4)']) });
    await expectNoAxeViolations(container);
  });

  it('draws a pedigree with its pattern check and a tree, each with no accessibility problems', async () => {
    const { container } = renderUi(<KitMolBioTool />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Pedigrees' }));
    expect(await screen.findByText(/autosomal recessive fits/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Family chart' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Insert Family chart' }));
    expect(inserted.at(-1)?.picture).toMatchObject({ mime: 'image/svg+xml', alt: 'Family chart' });
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('tab', { name: 'Trees' }));
    expect(await screen.findByRole('img', { name: 'Tree' })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('shows the cloning and population examples with no accessibility problems', async () => {
    const { container } = renderUi(<KitMolBioTool />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Cloning' }));
    expect(await screen.findByText('3 fragments: 3, 8, 7 bp.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Virtual gel' })).toBeTruthy();
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('tab', { name: 'Populations' }));
    expect(await screen.findByText(/frequency of A is 0\.5425/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });
});
