// The subject input fields and outputs: a data field that reads a table from the page, column roles, a matrix with
// words for a bad cell, the seed field, the coefficient table's verdicts in words, and a figure inserted as a block
// that reopens its tool. Each passes an accessibility scan.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { INSERT_EVENT, SUBJECT_TABLES_EVENT } from '../../flags';
import { registerKit, resetKits, takeKitInputs } from '../../kits/registry';
import { mountKitFigure } from '../figure/block';
import { ColumnPicker, DataField, MatrixField, SeedField } from './fields';
import type { DataInput, MatrixInputValue, RoleValue } from './input';
import { emptyMatrix, readDataInput } from './input';
import { CoefficientTable, SvgDiagram } from './output';
import SignTestTool from '../example/SignTestTool';

afterEach(() => resetKits());

describe('the example sign test tool', () => {
  it('works the first values, then names a line that is not a number', async () => {
    function Harness() {
      const [inputs, setInputs] = useState<unknown>(null);
      return <SignTestTool inputs={inputs} setInputs={setInputs} system="SI" />;
    }
    const { container } = renderUi(<Harness />);
    // 9 of 10 above zero: two-sided p = 22/1024 = 0.02148.
    expect(screen.getByText('0.02148')).toBeTruthy();
    expect(screen.getByText('At the 5% level the data are unlikely if the median were the one given.')).toBeTruthy();
    await expectNoAxeViolations(container);
    fireEvent.change(screen.getByLabelText('Values'), { target: { value: '1\nabc' } });
    expect(screen.getAllByText('Line 2 is not a number: "abc".').length).toBeGreaterThan(0);
  });
});

function DataHarness() {
  const [value, setValue] = useState<DataInput>({ text: '' });
  const [roles, setRoles] = useState<RoleValue>({});
  const data = readDataInput(value);
  return (
    <>
      <DataField label="Sample" value={value} onChange={setValue} data={data} />
      <ColumnPicker data={data} roles={[{ role: 'response', kinds: ['number'] }]} value={roles} onChange={setRoles} />
    </>
  );
}

const TABLE = {
  id: 'b1',
  type: 'table',
  data: {
    header: true,
    columns: [{ id: 'c1' }, { id: 'c2' }],
    rows: [
      { cells: { c1: 'dose', c2: 'response' } },
      { cells: { c1: '1', c2: '2.5' } },
      { cells: { c1: '2', c2: '4.1' } },
    ],
  },
};

describe('subject fields', () => {
  it('reads typed data, then a table from the open page', async () => {
    const { container } = renderUi(<DataHarness />);
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: 'x\n1\n2\n3' } });
    expect(screen.getByText('3 rows and 1 columns.')).toBeTruthy();

    const answer = (event: Event) => {
      (event as CustomEvent<{ blocks: unknown }>).detail.blocks = [TABLE];
    };
    window.addEventListener(SUBJECT_TABLES_EVENT, answer);
    fireEvent.click(screen.getByRole('button', { name: 'Find tables on the page' }));
    window.removeEventListener(SUBJECT_TABLES_EVENT, answer);
    fireEvent.click(await screen.findByRole('button', { name: 'Use this table' }));
    await waitFor(() => expect(screen.getByText('2 rows and 2 columns.')).toBeTruthy());
    const response = screen.getByLabelText('Response') as HTMLSelectElement;
    expect([...response.options].map((o) => o.textContent)).toEqual(['Choose a column', 'dose', 'response']);
    await expectNoAxeViolations(container);
  });

  it('says when no page answers', () => {
    renderUi(<DataHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Find tables on the page' }));
    expect(screen.getByText('Open a page with a table first.')).toBeTruthy();
  });

  it('names a matrix cell that is not a number and grows the grid', async () => {
    function Harness() {
      const [m, setM] = useState<MatrixInputValue>(emptyMatrix(2, 2));
      return <MatrixField label="Counts" value={m} onChange={setM} />;
    }
    const { container } = renderUi(<Harness />);
    expect(screen.getByText('Row 1, column 1 is not a number.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    expect(screen.getAllByLabelText(/^Row R3, column/)).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it('refuses a seed that is not a whole number and makes a new one', () => {
    function Harness() {
      const [seed, setSeed] = useState('42');
      return <SeedField value={seed} onChange={setSeed} />;
    }
    renderUi(<Harness />);
    const field = screen.getByLabelText('Seed') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '-1' } });
    expect(screen.getByText('Type a whole number from 0 to 18446744073709551615.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New seed' }));
    expect(field.value).toMatch(/^\d+$/);
  });
});

describe('subject outputs', () => {
  it('states each verdict in words', async () => {
    const { container } = renderUi(
      <CoefficientTable
        rows={[
          { term: 'Intercept', estimate: 2.2, se: 0.94, statistic: 2.34, p: 0.101, low: -0.79, high: 5.19 },
          { term: 'Slope', estimate: 0.6, se: 0.05, statistic: 12, p: 0.00001, low: 0.44, high: 0.76 },
        ]}
      />,
    );
    expect(screen.getByText('No clear difference from zero')).toBeTruthy();
    expect(screen.getByText('Differs from zero')).toBeTruthy();
    expect(screen.getByText('< 0.0001')).toBeTruthy();
    expect(screen.getByText('At the 5% level')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('inserts a figure block whose Open in tool button reopens the tool with its inputs', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const figure = {
      kit: 'demo',
      tool: 'tree',
      inputs: { depth: 2 },
      svg,
      alt: 'A small tree',
      summary: 'Tree: 3 nodes',
    };
    let sent: { type: string; data: Record<string, unknown>; fallback: string } | undefined;
    const take = (event: Event) => {
      const detail = (event as CustomEvent<{ block?: typeof sent; handled: boolean }>).detail;
      sent = detail.block;
      detail.handled = true;
    };
    window.addEventListener(INSERT_EVENT, take);
    renderUi(<SvgDiagram figure={figure} />);
    expect((screen.getByAltText('A small tree') as HTMLImageElement).src.startsWith('data:image/svg+xml')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Insert figure' }));
    window.removeEventListener(INSERT_EVENT, take);
    expect(sent?.type).toBe('kitfigure');
    expect(sent?.fallback).toBe('Tree: 3 nodes');

    let opened = '';
    registerKit('demo', (tool) => {
      opened = tool;
    });
    const host = document.createElement('div');
    document.body.append(host);
    const said: string[] = [];
    const handle = mountKitFigure(host, { data: sent?.data ?? {}, announce: (text) => said.push(text) });
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('img')?.getAttribute('alt')).toBe('A small tree');
    fireEvent.click(host.querySelector('button') as HTMLButtonElement);
    await waitFor(() => expect(opened).toBe('tree'));
    expect(takeKitInputs('demo', 'tree')).toEqual({ depth: 2 });
    expect(said).toEqual(['Opened the tool with this figure’s inputs.']);
    handle.destroy();
    host.remove();
  });
});
