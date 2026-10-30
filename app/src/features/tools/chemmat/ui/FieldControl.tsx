// One field of a tool: its label, a text box, area, or choice, a unit picker when the quantity has units, and help.
import chem from '../../ui/chem.module.css';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import { parseNumber } from '../input';
import type { FieldSpec } from '../spec';
import { DIMS } from '../units';
import type { UnitDim } from '../units';
import { tr } from './text';

interface Props {
  toolId: string;
  field: FieldSpec;
  value: string;
  unit: string | undefined;
  onValue(next: string): void;
  onUnit(dim: UnitDim, next: string): void;
}

function Control({
  id,
  field,
  value,
  onValue,
}: {
  id: string;
  field: FieldSpec;
  value: string;
  onValue(v: string): void;
}) {
  if (field.kind === 'choice') {
    return (
      <select id={id} className={extra.input} value={value} onChange={(e) => onValue(e.target.value)}>
        {field.choices?.map((c) => (
          <option key={c.value} value={c.value}>
            {tr(c.label)}
          </option>
        ))}
      </select>
    );
  }
  const describedBy = field.help ? `${id}-help` : undefined;
  if (field.kind === 'area') {
    return (
      <textarea
        id={id}
        className={extra.input}
        rows={4}
        value={value}
        spellCheck={false}
        aria-describedby={describedBy}
        onChange={(e) => onValue(e.target.value)}
      />
    );
  }
  const invalid = field.kind === 'number' && value.trim() !== '' && Number.isNaN(parseNumber(value));
  return (
    <input
      id={id}
      type="text"
      inputMode={field.kind === 'number' ? 'decimal' : 'text'}
      className={extra.input}
      value={value}
      spellCheck={false}
      autoComplete="off"
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(e) => onValue(e.target.value)}
    />
  );
}

export function FieldControl({ toolId, field, value, unit, onValue, onUnit }: Props) {
  const id = `chemmat-${toolId}-${field.id}`;
  const wide = field.kind !== 'number';
  return (
    <div className={wide ? chem.wide : undefined}>
      <div className={field.dim ? chem.withUnit : undefined}>
        <div className={extra.field}>
          <label htmlFor={id}>{tr(field.label)}</label>
          <Control id={id} field={field} value={value} onValue={onValue} />
        </div>
        {field.dim ? (
          <select
            className={extra.input}
            aria-label={tr('kitChemMat.common.unitFor', { name: tr(field.label) })}
            value={unit}
            onChange={(e) => onUnit(field.dim!, e.target.value)}
          >
            {DIMS[field.dim].units.map((u) => (
              <option key={u.symbol} value={u.symbol}>
                {u.symbol}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {field.help ? (
        <p id={`${id}-help`} className={tools.note}>
          {tr(field.help)}
        </p>
      ) : null}
    </div>
  );
}
