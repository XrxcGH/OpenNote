// Linguistics in the window: the starting syntax tree, a bracket error, a gloss problem, a derivation, and
// syllables.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { LinguisticsTool } from './LinguisticsTool';

describe('linguistics tool', () => {
  it('draws the starting tree and says where a bracket is missing', async () => {
    const { container } = renderUi(<LinguisticsTool />);
    expect(screen.getByRole('img', { name: /root S over the words: the cat sat/ })).toBeTruthy();
    await expectNoAxeViolations(container);
    fireEvent.change(screen.getByRole('textbox', { name: /^Labeled brackets/ }), {
      target: { value: '[S [NP the cat]' },
    });
    expect(screen.getByText('This bracket is not closed. (at character 1)')).toBeTruthy();
  });

  it('reports a word without a gloss', () => {
    renderUi(<LinguisticsTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Glosses' }));
    expect(screen.getByText('Every word and morpheme has a gloss.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /^Gloss line/ }), { target: { value: 'book-PL' } });
    expect(screen.getByText('Word 1, kitap-lar-ım, has 3 morphemes but 2 glosses.')).toBeTruthy();
  });

  it('derives forms and splits syllables', () => {
    renderUi(<LinguisticsTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(screen.getByRole('cell', { name: '[tep]' })).toBeTruthy();
    expect(screen.getByText('/tapi/: rules 1 and 2 are in a counterbleeding order.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Syllables' }));
    expect(screen.getByText('pan.da')).toBeTruthy();
  });
});
