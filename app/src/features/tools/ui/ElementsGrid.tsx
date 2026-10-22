// The periodic table as a grid of buttons, with a card of facts about the chosen element. One button is in the tab
// order, and the arrow keys move between elements, so the table is one stop for the keyboard. A family is told by its
// color and by its name in words on every button's label and on the card.
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { ELEMENTS } from '../reference/data';
import type { Element } from '../reference/data';
import { cellOf, neighborOf } from '../reference/gridLayout';
import type { NavKey } from '../reference/gridLayout';
import { ElementCard } from './ElementCard';
import grid from './elements.module.css';

const NAV_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function ElementsGrid({ elements }: { elements: readonly Element[] }) {
  const [selected, setSelected] = useState<number>(1);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const shown = new Set(elements.map((element) => element.number));
  const current = elements.find((element) => element.number === selected) ?? null;
  // The tab stop is the chosen element, or the first one shown when the search has hidden the chosen one.
  const stop = current ?? elements[0] ?? null;

  const onKeyDown = (event: KeyboardEvent, element: Element) => {
    if (!NAV_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = neighborOf(elements, element, event.key as NavKey);
    setSelected(next.number);
    buttons.current.get(next.number)?.focus();
  };

  return (
    <div className={grid.wrap}>
      <div className={grid.scroll}>
        <div className={grid.table} role="group" aria-label={t('study.reference.gridLabel')}>
          {ELEMENTS.map((element) => {
            const cell = cellOf(element);
            const style = { gridRow: cell.row, gridColumn: cell.col };
            if (!shown.has(element.number)) {
              return <span key={element.number} className={grid.ghost} style={style} aria-hidden="true" />;
            }
            return (
              <button
                key={element.number}
                ref={(node) => {
                  if (node) buttons.current.set(element.number, node);
                  else buttons.current.delete(element.number);
                }}
                type="button"
                className={grid.cell}
                style={style}
                data-group={element.group}
                aria-pressed={current?.number === element.number}
                aria-label={t('study.reference.cellLabel', {
                  name: element.name,
                  symbol: element.symbol,
                  number: element.number,
                  family: t(`study.reference.groups.${element.group}`),
                })}
                tabIndex={stop?.number === element.number ? 0 : -1}
                onClick={() => setSelected(element.number)}
                onFocus={() => setSelected(element.number)}
                onKeyDown={(event) => onKeyDown(event, element)}
              >
                <span className={grid.number} aria-hidden="true">
                  {element.number}
                </span>
                <span className={grid.symbol} aria-hidden="true">
                  {element.symbol}
                </span>
              </button>
            );
          })}
          <span className={grid.rowNote} style={{ gridRow: 9, gridColumn: '1 / 3' }} aria-hidden="true">
            57–70
          </span>
          <span className={grid.rowNote} style={{ gridRow: 10, gridColumn: '1 / 3' }} aria-hidden="true">
            89–102
          </span>
        </div>
      </div>
      <p className={grid.hint}>{t('study.reference.gridHint')}</p>
      {current ? <ElementCard element={current} /> : <p className={grid.hint}>{t('study.reference.pickElement')}</p>}
    </div>
  );
}
