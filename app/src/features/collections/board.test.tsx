// The board view in a real browser, inside a short dialog: its columns stay on screen and its Move select offers every
// choice of the property (Beta 8 walk B2-B13-3 and B2-B13-4).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import dialogStyles from '../../ui/Dialog.module.css';
import { emptyCollection, groupRows, toRow } from './engine';
import { BoardView } from './views';

afterEach(cleanup);

const options = ['Open', 'Doing', 'Closed'];
const rows = ['Plan', 'Notes'].map((title) =>
  toRow({
    page: title.toLowerCase(),
    notebook: 'n',
    section: 's',
    title,
    created: 0,
    modified: 0,
    tags: [],
    hasProperties: true,
    properties: { fields: [{ id: 'a', name: 'Stage', type: 'choice', value: 'Doing', options }] },
  }),
);

it('keeps its columns on screen in a dialog shorter than its content, and offers every choice', () => {
  const def = { ...emptyCollection('c', 'Tasks'), groupBy: 'Stage', view: 'board' as const };
  const words = { none: 'No value', yes: 'Yes', no: 'No' };
  render(
    // The dialog's content: a grid that scrolls, here squeezed by a short window.
    <dialog
      open
      className={dialogStyles.dialog}
      style={{ blockSize: '260px', display: 'flex', flexDirection: 'column' }}
    >
      <div className={dialogStyles.content}>
        <p style={{ blockSize: '400px', margin: 0 }}>Rules</p>
        <BoardView
          groups={groupRows(rows, def, words)}
          rows={rows}
          names={['Stage']}
          def={def}
          onOpen={() => undefined}
          onEdit={() => undefined}
          onSort={() => undefined}
        />
      </div>
    </dialog>,
  );
  const column = screen.getByRole('region', { name: 'Doing' });
  expect(column.parentElement!.getBoundingClientRect().height).toBeGreaterThan(100);
  const move = screen.getByRole('combobox', { name: /Plan/ });
  expect([...(move as HTMLSelectElement).options].map((option) => option.text)).toEqual([
    'Closed',
    'Doing',
    'Open',
    'No value',
  ]);
});
