// checks-disable-file modifiability: the panel is one component that holds the form state

// One calculating tool of the kit: its fields with a unit for each number, a choice of SI or US units, ready-made
// examples, the results, and the Insert menu. The typed texts are kept on this device for each tool, and the unit
// system for the whole kit.
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import { convertTexts, firstTexts, firstUnits, runTool, type FieldError } from '../kit/read';
import { shownFields, type Field, type ToolSpec } from '../kit/spec';
import { unitsOf, type System } from '../kit/units';
import {
  answerLatex,
  answerText,
  extraTable,
  pictureRequest,
  resultTable,
  sendToPage,
  stepsHtml,
  type InsertContext,
  type Say,
} from './insert';
import { Results, pagePicture } from './Results';
import { load, save } from './store';
import styles from './design.module.css';

/** t for keys built at run time. Every key the kit builds exists in strings/en/kitDesign.ts (a test checks). */
export const say = t as unknown as Say;

export function problemText(problem: string, detail?: string): string {
  return say(`kitDesign.error.${problem}`, { detail: detail ?? '' });
}

function NumberInput(props: {
  tool: string;
  field: Field & { type: 'num' };
  text: string;
  unit: string;
  error: FieldError | undefined;
  onText: (text: string) => void;
  onUnit: (unit: string) => void;
}) {
  const { tool, field, text, unit, error } = props;
  const id = useId();
  const label = say(`kitDesign.${tool}.field.${field.id}`);
  const options = field.dim ? unitsOf(field.dim) : [];
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.entry}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className={styles.input}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-problem` : undefined}
          onChange={(event) => props.onText(event.target.value)}
        />
        {options.length > 1 ? (
          <select
            className={`${styles.input} ${styles.unitSelect}`}
            value={unit}
            aria-label={say('kitDesign.ui.unitFor', { field: label })}
            onChange={(event) => props.onUnit(event.target.value)}
          >
            {options.map((one) => (
              <option key={one.label} value={one.label}>
                {one.label}
              </option>
            ))}
          </select>
        ) : (
          options[0] && (
            <span className={styles.unit} aria-hidden="true">
              {options[0].label}
            </span>
          )
        )}
      </div>
      {error && (
        <p id={`${id}-problem`} className={styles.problem}>
          {say(`kitDesign.error.${error === 'empty' ? 'typeNumber' : 'notNumber'}`)}
        </p>
      )}
    </div>
  );
}

function FieldInput(props: {
  tool: string;
  field: Field;
  text: string;
  unit: string;
  error: FieldError | undefined;
  onText: (text: string) => void;
  onUnit: (unit: string) => void;
}) {
  const { tool, field, text } = props;
  const id = useId();
  const label = say(`kitDesign.${tool}.field.${field.id}`);
  if (field.type === 'choice') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <select className={styles.input} value={text} onChange={(event) => props.onText(event.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {say(`kitDesign.${tool}.option.${option}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'text') {
    return (
      <div className={`${styles.field} ${styles.wide}`}>
        <label htmlFor={id}>{label}</label>
        <textarea
          id={id}
          className={`${styles.input} ${styles.textarea}`}
          rows={field.rows}
          value={text}
          spellCheck={false}
          aria-describedby={`${id}-hint`}
          onChange={(event) => props.onText(event.target.value)}
        />
        <span id={`${id}-hint`} className={styles.hint}>
          {say(`kitDesign.${tool}.hint.${field.id}`)}
        </span>
      </div>
    );
  }
  return <NumberInput {...props} field={field} />;
}

function insertItems(c: InsertContext): MenuItemSpec[] {
  const done = (ok: boolean) => announce(say(ok ? 'kitDesign.ui.inserted' : 'kitDesign.ui.noPage'));
  const items: MenuItemSpec[] = [
    {
      id: 'answer',
      label: say('kitDesign.ui.insertAnswer'),
      onSelect: () => done(sendToPage({ text: `${answerText(c)} ` })),
    },
    {
      id: 'equation',
      label: say('kitDesign.ui.insertEquation'),
      onSelect: () => done(sendToPage({ math: { source: answerLatex(c), display: true } })),
    },
    {
      id: 'table',
      label: say('kitDesign.ui.insertTable'),
      onSelect: () => done(sendToPage({ table: resultTable(c) })),
    },
    { id: 'steps', label: say('kitDesign.ui.insertSteps'), onSelect: () => done(sendToPage({ text: stepsHtml(c) })) },
  ];
  c.outcome.tables?.forEach((table, i) =>
    items.push({
      id: `table-${table.id}`,
      label: say(`kitDesign.${c.tool}.table.${table.id}`),
      onSelect: () => {
        const extra = extraTable(c, i);
        if (extra) done(sendToPage({ table: extra }));
      },
    }),
  );
  const svgText = pagePicture(c);
  if (svgText && c.outcome.plot) {
    const alt = say(`kitDesign.${c.tool}.plot.${c.outcome.plot.id}.alt`);
    items.push({
      id: 'picture',
      label: say('kitDesign.ui.insertPicture'),
      onSelect: () => done(sendToPage({ picture: pictureRequest(svgText, `${c.tool}.svg`, alt) })),
    });
  }
  return items;
}

/** The system the kit last used. */
export const savedSystem = (): System => (load<string>('system', 'si') === 'us' ? 'us' : 'si');

export function ToolPanel({ tool, spec }: { tool: string; spec: ToolSpec }) {
  const [system, setSystem] = useState<System>(savedSystem);
  const [texts, setTexts] = useState<Record<string, string>>(() => ({
    ...firstTexts(spec),
    ...load(`${tool}.texts`, {}),
  }));
  const [units, setUnits] = useState<Record<string, string>>(() => ({
    ...firstUnits(spec, savedSystem()),
    ...load(`${tool}.units`, {}),
  }));
  useEffect(() => save(`${tool}.texts`, texts), [tool, texts]);
  useEffect(() => save(`${tool}.units`, units), [tool, units]);
  useEffect(() => save('system', system), [system]);
  const run = useMemo(() => runTool(spec, texts, units), [spec, texts, units]);
  const choices = Object.fromEntries(
    spec.fields.filter((f) => f.type === 'choice').map((f) => [f.id, texts[f.id] ?? f.def]),
  );
  const errors = run.ok ? new Map<string, FieldError>() : run.fields;
  const changeSystem = (next: System) => {
    if (next === system) return;
    const converted = convertTexts(spec, texts, units, next);
    setTexts(converted.texts);
    setUnits(converted.units);
    setSystem(next);
  };
  const pickExample = (id: string) => {
    const example = spec.examples?.find((one) => one.id === id);
    if (!example) return;
    setTexts({ ...firstTexts(spec), ...example.values });
    setUnits(firstUnits(spec, 'si'));
  };
  const hasUnits = spec.fields.some((field) => field.type === 'num' && field.dim !== undefined);
  const outcome = run.ok && run.result.ok ? run.result.outcome : null;
  const openInsert = (anchor: HTMLElement) => {
    if (!outcome) return;
    const c: InsertContext = { tool, outcome, system, say };
    void openMenu({ label: say('kitDesign.ui.insertMenu'), items: insertItems(c), anchor });
  };
  return (
    <div className={styles.panel}>
      <p className={styles.hint}>{say(`kitDesign.${tool}.about`)}</p>
      <div className={styles.row}>
        {hasUnits && (
          <label className={styles.field}>
            <span>{say('kitDesign.ui.units')}</span>
            <select
              className={styles.input}
              value={system}
              onChange={(event) => changeSystem(event.target.value as System)}
            >
              <option value="si">{say('kitDesign.ui.si')}</option>
              <option value="us">{say('kitDesign.ui.us')}</option>
            </select>
          </label>
        )}
        {spec.examples && (
          <label className={styles.field}>
            <span>{say('kitDesign.ui.example')}</span>
            <select className={styles.input} value="" onChange={(event) => pickExample(event.target.value)}>
              <option value="">{say('kitDesign.ui.exampleNone')}</option>
              {spec.examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {say(`kitDesign.${tool}.example.${example.id}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.row}>
        {shownFields(spec, choices).map((field) => (
          <FieldInput
            key={field.id}
            tool={tool}
            field={field}
            text={texts[field.id] ?? field.def}
            unit={units[field.id] ?? ''}
            error={errors.get(field.id)}
            onText={(text) => setTexts((current) => ({ ...current, [field.id]: text }))}
            onUnit={(unit) => setUnits((current) => ({ ...current, [field.id]: unit }))}
          />
        ))}
      </div>
      {!run.ok && (
        <p className={styles.problem} role="status">
          {say('kitDesign.ui.fixFields')}
        </p>
      )}
      {run.ok && !run.result.ok && (
        <p className={styles.problem} role="status">
          {problemText(run.result.problem, run.result.detail)}
        </p>
      )}
      {outcome && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
              {say('kitDesign.ui.insert')}
            </Button>
          </div>
          <Results tool={tool} outcome={outcome} system={system} say={say} units={hasUnits} />
        </>
      )}
    </div>
  );
}
