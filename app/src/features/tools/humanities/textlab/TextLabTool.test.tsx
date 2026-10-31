// Text analysis in the window: readability of the starting sentence, an empty text, the concordance, comparing
// versions, and Latin scansion.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { TextLabTool } from './TextLabTool';

const textField = () => screen.getByRole('textbox', { name: /^Text/ });

describe('text analysis tool', () => {
  it('scores the starting sentence and says when the text is empty', async () => {
    const { container } = renderUi(<TextLabTool />);
    expect(screen.getByText('116.145')).toBeTruthy();
    expect(screen.getByText('-1.45')).toBeTruthy();
    await expectNoAxeViolations(container);
    fireEvent.change(textField(), { target: { value: '   ' } });
    expect(screen.getByText('Type some text first.')).toBeTruthy();
  });

  it('finds a word in context and lists a variant', () => {
    renderUi(<TextLabTool />);
    fireEvent.change(textField(), { target: { value: 'the red fox and the red hen' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Concordance' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Word or phrase' }), { target: { value: 'red' } });
    expect(screen.getByText('2 lines')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Compare versions' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Witness text' }), {
      target: { value: 'the red fox and the brown hen' },
    });
    expect(screen.getByRole('cell', { name: 'brown' })).toBeTruthy();
  });

  it('scans a Latin hexameter', () => {
    renderUi(<TextLabTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Scansion' }));
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'latin' } });
    expect(screen.getByText('Hexameter: DDSSDS')).toBeTruthy();
  });
});
