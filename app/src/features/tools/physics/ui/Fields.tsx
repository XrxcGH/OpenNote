// The fields of a physics tool's mode: numbers with a unit picker limited to what the number measures, choices,
// vectors typed as a list, and rows of numbers (point charges, wire segments, optical elements) one per line.
// Every field has a visible label; a unit picker is named for its field.
import { useId } from 'react';
import { t } from '../../../../strings/t';
import { parseNumber } from '../kit/read';
import { sayKey } from '../kit/say';
import type { FieldColumn, FieldDef, ModeDef, ToolInputs, UnitSystem } from '../kit/types';
import { DIMS, defaultUnit, unitOf } from '../kit/units';
import type { DimId } from '../kit/units';
import chem from '../../ui/chem.module.css';
import extra from '../../ui/extra.module.css';
import tools from '../../ui/tools.module.css';
import styles from './physics.module.css';

interface FieldsProps {
  mode: ModeDef;
  inputs: ToolInputs;
  system: UnitSystem;
  onText(id: string, value: string): void;
  onUnit(key: string, unit: string): void;
}

function UnitPicker(props: { dim: DimId; value: string; label: string; onChange(unit: string): void }) {
  return (
    <select
      className={extra.input}
      aria-label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {DIMS[props.dim].units.map(([symbol]) => (
        <option key={symbol} value={symbol}>
          {symbol}
        </option>
      ))}
    </select>
  );
}

const pickedUnit = (inputs: ToolInputs, key: string, dim: DimId, system: UnitSystem, si?: string, us?: string) => {
  const picked = inputs.unit[key];
  return picked && unitOf(dim, picked) ? picked : defaultUnit(dim, system, si, us);
};

function labelOf(field: FieldDef): string {
  const name = sayKey(field.label);
  return field.optional ? t('kitPhysics.ui.optional', { name }) : name;
}

function ColumnUnits(props: FieldsProps & { field: FieldDef; columns: readonly FieldColumn[] }) {
  const { field, columns, inputs, system, onUnit } = props;
  const list = sayKey(field.label);
  return (
    <div className={styles.columns}>
      {columns.map((column, i) =>
        column.dim ? (
          <UnitPicker
            key={i}
            dim={column.dim}
            label={t('kitPhysics.ui.columnUnit', { name: sayKey(column.label), list })}
            value={pickedUnit(inputs, `${field.id}.${i}`, column.dim, system, column.unit)}
            onChange={(unit) => onUnit(`${field.id}.${i}`, unit)}
          />
        ) : null,
      )}
    </div>
  );
}

function Field(props: FieldsProps & { field: FieldDef }) {
  const { field, inputs, system, onText, onUnit } = props;
  const id = `physics-${useId().replace(/:/g, '')}-${field.id}`;
  const value = inputs.text[field.id] ?? field.initial;
  const label = labelOf(field);
  const kind = field.kind ?? 'number';
  const helpId = `${id}-help`;
  const columns = field.columns ?? [];
  const help =
    kind === 'rows'
      ? t('kitPhysics.ui.rowsHelp', { columns: columns.map((one) => sayKey(one.label)).join(', ') })
      : field.help
        ? sayKey(field.help)
        : null;
  const invalid = kind === 'number' && value.trim() !== '' && Number.isNaN(parseNumber(value));
  const describedBy = help ? helpId : undefined;
  let control;
  if (kind === 'choice') {
    control = (
      <select id={id} className={extra.input} value={value} onChange={(event) => onText(field.id, event.target.value)}>
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {sayKey(option.label)}
          </option>
        ))}
      </select>
    );
  } else if (kind === 'rows') {
    control = (
      <textarea
        id={id}
        className={`${extra.input} ${styles.rows}`}
        value={value}
        spellCheck={false}
        aria-describedby={describedBy}
        onChange={(event) => onText(field.id, event.target.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        inputMode={kind === 'number' ? 'decimal' : 'text'}
        className={extra.input}
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onText(field.id, event.target.value)}
      />
    );
  }
  const wide = kind === 'rows' || kind === 'vector';
  return (
    <div className={wide ? chem.wide : undefined}>
      <div className={field.dim && kind !== 'rows' ? chem.withUnit : undefined}>
        <div className={extra.field}>
          <label htmlFor={id}>{label}</label>
          {control}
        </div>
        {field.dim && kind !== 'rows' ? (
          <UnitPicker
            dim={field.dim}
            label={t('kitPhysics.ui.unitFor', { name: sayKey(field.label) })}
            value={pickedUnit(inputs, field.id, field.dim, system, field.unit, field.usUnit)}
            onChange={(unit) => onUnit(field.id, unit)}
          />
        ) : null}
      </div>
      {kind === 'rows' ? <ColumnUnits {...props} field={field} columns={columns} /> : null}
      {help ? (
        <p id={helpId} className={tools.note}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function Fields(props: FieldsProps) {
  const choice = (id: string) => props.inputs.text[id] ?? props.mode.fields.find((one) => one.id === id)?.initial ?? '';
  const shown = props.mode.fields.filter((field) => !field.when || field.when(choice));
  return (
    <div className={chem.grid}>
      {shown.map((field) => (
        <Field key={`${props.mode.id}.${field.id}`} {...props} field={field} />
      ))}
    </div>
  );
}
