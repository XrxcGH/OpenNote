// The error button of the formula bar: the cell's error token (#N/A), which opens a popover that says in plain words
// why the cell shows it (explain.ts), with Trace error to go to the cell where the error starts.
import { useMemo, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, Popover } from '../../../../ui';
import type { TableExtraHost } from '../../../page';
import { ERROR_TOKENS } from '../../engine/values';
import type { ErrorCode } from '../../engine/values';
import { explainError } from './explain';
import { originCellName, traceError } from './origin';
import { pageTables } from './page';
import { selectBox } from './sync';
import type { Active } from './sync';
import styles from './formulaBar.module.css';

export function ErrorButton({ host, active }: { host: TableExtraHost; active: Active }) {
  const [open, setOpen] = useState(false);
  const [traced, setTraced] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const token = ERROR_TOKENS[active.error as ErrorCode] ?? active.error ?? '';
  const words = useMemo(() => {
    if (!open) return null;
    const page = pageTables(host);
    const row = active.at.row - (active.header ? 1 : 0);
    if (!page || row < 0) return null;
    const name = originCellName(page);
    const { first, last } = traceError(page, active.at.column, row);
    if (!first) return { cause: t('sheetFormula.error.noOrigin'), last: null, page, name };
    return { ...explainError(first.origin, first.formula, name), last: last ?? null, page, name };
  }, [open, host, active]);

  const trace = () => {
    const last = words?.last;
    if (!last || !words) return;
    const cell = words.name(last.cell);
    setTraced(t('sheetFormula.error.traced', { cell }));
    host.announce(t('sheetFormula.error.traced', { cell }));
    if (last.cell.table === words.page.own) {
      const row = last.cell.row + (active.header ? 1 : 0);
      selectBox(host.editor.view, { top: row, left: last.cell.col, bottom: row, right: last.cell.col });
    }
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={styles.errorButton}
        aria-label={t('sheetFormula.error.button', { token })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setTraced(null);
          setOpen((was) => !was);
        }}
      >
        {token}
      </button>
      <Popover
        anchor={anchor}
        label={t('sheetFormula.error.title', { token })}
        open={open}
        onClose={() => setOpen(false)}
      >
        <div className={styles.explain} data-formula-explain="">
          <p>{words?.cause}</p>
          {words && 'detail' in words && words.detail ? <p>{words.detail}</p> : null}
          {traced ? <p role="status">{traced}</p> : null}
          {words?.last ? (
            <Button variant="secondary" onClick={trace}>
              {t('sheetFormula.error.trace')}
            </Button>
          ) : null}
        </div>
      </Popover>
    </>
  );
}
