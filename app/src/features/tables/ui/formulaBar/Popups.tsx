// What shows under the entry while a formula is typed: the autocomplete list, or the argument hint of the function
// the caret is in, with the current argument in bold and its description below.
import { t } from '../../../../strings/t';
import { VisuallyHidden } from '../../../../ui/VisuallyHidden';
import type { Completion } from './complete';
import type { Hint } from './complete';
import { fnInfo, hintParts, specOf } from './functions';
import styles from './formulaBar.module.css';

export interface SuggestListProps {
  id: string;
  completion: Completion;
  selected: number;
  choose(index: number): void;
}

export function SuggestList({ id, completion, selected, choose }: SuggestListProps) {
  return (
    <div className={styles.popup}>
      <ul id={id} role="listbox" aria-label={t('sheetFormula.bar.suggestions')} className={styles.list}>
        {completion.items.map((item, i) => (
          <li
            key={`${item.kind}:${item.label}`}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === selected}
            className={styles.option}
            // A press picks the item without taking focus from the entry.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(i);
            }}
          >
            <span>{item.label}</span>
            <span className={styles.detail}>
              {item.detail
                ? t('sheetFormula.kinds.withDetail', {
                    kind: t(`sheetFormula.kinds.${item.kind}`),
                    detail: item.detail,
                  })
                : t(`sheetFormula.kinds.${item.kind}`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HintLine({ id, hint }: { id: string; hint: Hint }) {
  const spec = specOf(hint.name);
  const info = fnInfo(hint.name);
  if (!spec) return null;
  const parts = hintParts(spec);
  const current = parts[hint.part];
  const items = parts.map((part, i) => {
    const label = part.optional ? `[${part.name}]` : part.name;
    return (
      <span key={`${part.name}:${i}`}>
        {i > 0 ? t('sheetFormula.hint.between') : ''}
        {i === hint.part ? (
          <>
            <strong data-current-arg="" aria-hidden="true">
              {label}
            </strong>
            <VisuallyHidden>{t('sheetFormula.hint.current', { name: label })}</VisuallyHidden>
          </>
        ) : (
          label
        )}
        {part.repeat && i === parts.length - 1 ? t('sheetFormula.hint.more') : ''}
      </span>
    );
  });
  return (
    // No aria-label here: the entry's description is the hint's own text: the signature with the current argument.
    <div className={styles.popup} id={id} role="tooltip">
      <div className={styles.hint}>
        {spec.name}({items})
      </div>
      {current && info?.args[current.name] ? <div className={styles.detail}>{info.args[current.name]}</div> : null}
    </div>
  );
}
