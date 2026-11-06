// The ANOVA tool's two-way design: a big paste with too few columns answers at once, and a column role that is
// emptied, or names a column the data no longer has, is reported by its name.
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../../test';
import GroupsTool from './Tool';

function Harness({ first }: { first: unknown }) {
  const [inputs, setInputs] = useState<unknown>(first);
  return <GroupsTool inputs={inputs} setInputs={setInputs} system="SI" />;
}

const rows = (count: number, columns: number) =>
  [Array.from({ length: columns }, (_, j) => `c${j}`).join(',')]
    .concat(Array.from({ length: count }, (_, i) => Array.from({ length: columns }, (_, j) => `${i + j}`).join(',')))
    .join('\n');

const THREE = 'The data need at least 3 columns: 2 factors and a response.';

/** Puts text on the clipboard the way a student copies it, and selects the box, ready to paste. */
async function copyThenSelect(box: HTMLElement, text: string) {
  const source = document.createElement('textarea');
  document.body.append(source);
  source.value = text;
  source.focus();
  source.select();
  await userEvent.copy();
  source.remove();
  await userEvent.click(box);
  await userEvent.keyboard('{Control>}a{/Control}');
}

describe('the ANOVA tool with a big paste', () => {
  it('answers 10,000 rows of 2 columns in under a second', async () => {
    const started = performance.now();
    renderUi(<Harness first={{ mode: 'twoway', data: { text: rows(10_000, 2), table: null } }} />);
    expect(await screen.findByText(THREE)).toBeTruthy();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('takes a paste of 10,000 rows of 2 columns in under a second', async () => {
    renderUi(<Harness first={{ mode: 'twoway' }} />);
    const box = await screen.findByRole('textbox', { name: 'Data' });
    await copyThenSelect(box, rows(10_000, 2));
    const started = performance.now();
    await userEvent.paste();
    expect(await screen.findByText(THREE)).toBeTruthy();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('the ANOVA tool column roles', () => {
  it('lets a role be emptied, and then names it', async () => {
    renderUi(<Harness first={{ mode: 'twoway' }} />);
    const factor = await screen.findByRole('combobox', { name: 'Factor A' });
    expect((factor as HTMLSelectElement).value).toBe('dose');
    await userEvent.selectOptions(factor, 'Choose a column');
    expect((screen.getByRole('combobox', { name: 'Factor A' }) as HTMLSelectElement).value).toBe('');
    expect(await screen.findByText('Choose a column for Factor A.')).toBeTruthy();
  });

  it('names a role whose column the data no longer has', async () => {
    renderUi(<Harness first={{ mode: 'twoway', factorB: 'gone', response: 'dose' }} />);
    expect(await screen.findByText('Choose a column for Factor B.')).toBeTruthy();
    expect(within(document.body).queryByText('Choose the columns to use.')).toBeNull();
  });

  it('names the response when it is not a column of numbers', async () => {
    renderUi(<Harness first={{ mode: 'twoway', response: 'timing' }} />);
    expect(await screen.findByText('Choose a column of numbers for Response.')).toBeTruthy();
  });
});

describe('the ANOVA tool data box file', () => {
  it('says which file it read, and says when a damaged file could not be read', async () => {
    renderUi(<Harness first={{ mode: 'oneway' }} />);
    const box = (await screen.findByRole('textbox', { name: 'Groups, one to a line' })) as HTMLTextAreaElement;
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(picker, new File(['A: 1, 2, 3\nB: 4, 5, 6'], 'groups.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Read groups.txt.')).toBeTruthy();
    expect(box.value).toBe('A: 1, 2, 3\nB: 4, 5, 6');
    await userEvent.upload(picker, new File([new Uint8Array([0, 0, 255, 254, 1, 2, 0, 3])], 'broken.bin'));
    expect(await screen.findByText('The file could not be read.')).toBeTruthy();
    expect(box.value).toBe('A: 1, 2, 3\nB: 4, 5, 6');
  });
});
