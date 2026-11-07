// The correlation tool's column pickers: a picker can be emptied, and the problem names the role.
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../../test';
import CorrelationTool from './Tool';

function Harness({ first }: { first: unknown }) {
  const [inputs, setInputs] = useState<unknown>(first);
  return <CorrelationTool inputs={inputs} setInputs={setInputs} system="SI" />;
}

const DATA = { text: 'a,b,c\n1,2,3\n2,4,5\n3,5,4\n4,9,8\n5,9,9', table: null };

describe('the correlation tool column pickers', () => {
  it('lets a column be emptied, and then names its role', async () => {
    renderUi(<Harness first={{ mode: 'pair', source: 'data', data: DATA }} />);
    const x = await screen.findByRole('combobox', { name: 'Column x' });
    expect((x as HTMLSelectElement).value).toBe('a');
    await userEvent.selectOptions(x, 'Choose a column');
    expect((screen.getByRole('combobox', { name: 'Column x' }) as HTMLSelectElement).value).toBe('');
    expect(await screen.findByText('Choose a column of numbers for Column x.')).toBeTruthy();
  });

  it('names the columns role when every box of the matrix is cleared', async () => {
    renderUi(<Harness first={{ mode: 'matrix', source: 'data', data: DATA }} />);
    for (const name of ['a', 'b', 'c']) await userEvent.click(await screen.findByRole('checkbox', { name }));
    expect(await screen.findByText('Choose a column of numbers for Columns.')).toBeTruthy();
  });
});
