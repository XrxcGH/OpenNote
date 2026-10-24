// One tool of the kit: its fields, a choice of SI or US units, ready-made examples, the results, and the Insert
// menu. The typed texts are kept on this device for each tool, and the unit system for the whole kit.
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import { PAGE } from '../kit/picture';
import { firstTexts, pinUnits, runTool } from '../kit/read';
import { shownFields, type Field, type ToolSpec } from '../kit/spec';
import type { SolidsError } from '../kit/types';
import { unitOf, type System } from '../kit/units';
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
import { Results, pictureSvg } from './Results';
import styles from './solids.module.css';

/** t for keys built at run time. Every key the kit builds exists in strings/en/kitSolids.ts (a test checks). */
export const say = t as unknown as Say;

const PREFIX = 'opennote.tools.kitSolids.';

function load<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function save(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // The tool keeps working; it just will not remember.
  }
}

export function errorText(error: SolidsError): string {
  const [detail, other = ''] = error.detail.split('|');
  return say(`kitSolids.error.${error.code}`, { detail, other });
}

function FieldInput(props: {
  tool: string;
  field: Field;
  text: string;
  system: System;
  problem: SolidsError | undefined;
  onChange: (text: string) => void;
}) {
  const { tool, field, text, system, problem } = props;
  const id = useId();
  const label = say(`kitSolids.${tool}.field.${field.id}`);
  if (field.type === 'choice') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <select className={styles.input} value={text} onChange={(event) => props.onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {say(`kitSolids.${tool}.option.${option}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const describedBy = problem ? `${id}-problem` : `${id}-hint`;
  const hint =
    field.type === 'text'
      ? say(`kitSolids.${tool}.hint.${field.id}`, {
          length: unitOf('length', system),
          area: unitOf('area', system),
          span: unitOf('span', system),
          force: unitOf('bigForce', system),
          load: unitOf('spanLoad', system),
          moment: unitOf('bigMoment', system),
        })
      : '';
  const unit = field.type === 'quantity' ? unitOf(field.kind, system) : '';
  return (
    <div className={field.type === 'text' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.entry}>
        {field.type === 'text' ? (
          <textarea
            id={id}
            className={`${styles.input} ${styles.textarea}`}
            rows={field.rows}
            value={text}
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => props.onChange(event.target.value)}
          />
        ) : (
          <input
            id={id}
            type="text"
            inputMode="decimal"
            className={styles.input}
            value={text}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => props.onChange(event.target.value)}
          />
        )}
        {unit && (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {problem ? (
        <p id={`${id}-problem`} className={styles.problem}>
          {errorText(problem)}
        </p>
      ) : (
        <span id={`${id}-hint`} hidden={field.type !== 'text'}>
          {field.type === 'text' ? hint : say('kitSolids.ui.unitHint', { unit: unit || '1' })}
        </span>
      )}
    </div>
  );
}

function insertItems(c: InsertContext): MenuItemSpec[] {
  const done = (ok: boolean) => announce(say(ok ? 'kitSolids.ui.inserted' : 'kitSolids.ui.noPage'));
  const items: MenuItemSpec[] = [
    {
      id: 'answer',
      label: say('kitSolids.ui.insertAnswer'),
      onSelect: () => done(sendToPage({ text: `${answerText(c)} ` })),
    },
    {
      id: 'equation',
      label: say('kitSolids.ui.insertEquation'),
      onSelect: () => done(sendToPage({ math: { source: answerLatex(c), display: true } })),
    },
    {
      id: 'table',
      label: say('kitSolids.ui.insertTable'),
      onSelect: () => done(sendToPage({ table: resultTable(c) })),
    },
    { id: 'steps', label: say('kitSolids.ui.insertSteps'), onSelect: () => done(sendToPage({ text: stepsHtml(c) })) },
  ];
  c.outcome.tables?.forEach((table, i) =>
    items.push({
      id: `table-${table.id}`,
      label: say(`kitSolids.${c.tool}.table.${table.id}`),
      onSelect: () => {
        const extra = extraTable(c, i);
        if (extra) done(sendToPage({ table: extra }));
      },
    }),
  );
  const svgText = pictureSvg(c, PAGE);
  if (svgText) {
    const alt = say(`kitSolids.${c.tool}.picture`);
    items.push({
      id: 'picture',
      label: say('kitSolids.ui.insertPicture'),
      onSelect: () => done(sendToPage({ picture: pictureRequest(svgText, `${c.tool}.svg`, alt) })),
    });
  }
  return items;
}

export function ToolPanel({ tool, spec }: { tool: string; spec: ToolSpec }) {
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...firstTexts(spec), ...load(tool, {}) }));
  const [system, setSystem] = useState<System>(() => (load<string>('system', 'si') === 'us' ? 'us' : 'si'));
  useEffect(() => save(tool, texts), [tool, texts]);
  useEffect(() => save('system', system), [system]);
  const run = useMemo(() => runTool(spec, texts, system), [spec, texts, system]);
  const values = run.ok ? run.values : Object.fromEntries(spec.fields.map((f) => [f.id, texts[f.id] ?? f.first]));
  const problems = new Map(run.ok ? [] : run.fields.map((one) => [one.field, one.error] as const));
  const changeSystem = (next: System) => {
    if (next === system) return;
    setTexts(pinUnits(spec, texts, system));
    setSystem(next);
  };
  const pickExample = (id: string) => {
    const example = spec.examples?.find((one) => one.id === id);
    if (example) setTexts({ ...firstTexts(spec), ...example.values });
  };
  const openInsert = (anchor: HTMLElement) => {
    if (!run.ok) return;
    const c: InsertContext = { tool, outcome: run.outcome, system, say };
    void openMenu({ label: say('kitSolids.ui.insertMenu'), items: insertItems(c), anchor });
  };
  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{say('kitSolids.ui.units')}</span>
          <select
            className={styles.input}
            value={system}
            onChange={(event) => changeSystem(event.target.value as System)}
          >
            <option value="si">{say('kitSolids.ui.si')}</option>
            <option value="us">{say('kitSolids.ui.us')}</option>
          </select>
        </label>
        {spec.examples && (
          <label className={styles.field}>
            <span>{say('kitSolids.ui.example')}</span>
            <select className={styles.input} value="" onChange={(event) => pickExample(event.target.value)}>
              <option value="">{say('kitSolids.ui.exampleNone')}</option>
              {spec.examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {say(`kitSolids.${tool}.example.${example.id}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.row}>
        {shownFields(spec, values).map((field) => (
          <FieldInput
            key={field.id}
            tool={tool}
            field={field}
            text={texts[field.id] ?? field.first}
            system={system}
            problem={problems.get(field.id)}
            onChange={(text) => setTexts((current) => ({ ...current, [field.id]: text }))}
          />
        ))}
      </div>
      {!run.ok && (
        <p className={styles.problem} role="status">
          {run.error ? errorText(run.error) : say('kitSolids.ui.fixFields')}
        </p>
      )}
      {run.ok && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
              {say('kitSolids.ui.insert')}
            </Button>
          </div>
          <Results tool={tool} outcome={run.outcome} system={system} say={say} />
        </>
      )}
    </div>
  );
}
