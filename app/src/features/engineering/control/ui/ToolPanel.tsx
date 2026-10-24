// One tool of the kit: its fields, the unit system when the tool has physical quantities, ready-made examples, the
// results, and the Insert menu. The typed texts are kept on this device for each tool, and the unit
// system for the whole kit.
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import { PAGE } from './plot';
import { pinUnits, runTool, type Problem } from './read';
import { firstTexts, shownFields, type Field, type ToolSpec } from './spec';
import { unitOf, type System } from './units';
import {
  answerLatex,
  answerText,
  extraTable,
  pictureRequest,
  plotText,
  resultTable,
  sendToPage,
  stepsHtml,
  type InsertContext,
  type Say,
} from './insert';
import { Results } from './Results';
import styles from './control.module.css';

/** t for keys built at run time. Every key the kit builds exists in strings/en/kitControl.ts (a test checks). */
export const say = t as unknown as Say;

const PREFIX = 'opennote.tools.kitControl.';

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

const problemText = (problem: Problem) => say(problem.key, problem.vars);

function FieldInput(props: {
  tool: string;
  field: Field;
  text: string;
  system: System;
  problem: Problem | undefined;
  onChange: (text: string) => void;
}) {
  const { tool, field, text, system, problem } = props;
  const id = useId();
  const label = say(`kitControl.${tool}.field.${field.id}`);
  if (field.type === 'choice') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <select className={styles.input} value={text} onChange={(event) => props.onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {say(`kitControl.${tool}.option.${option}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const box = field.type === 'text' && (field.rows ?? 1) > 1;
  const unit = field.type === 'number' && field.unit ? unitOf(field.unit, system) : '';
  const hint =
    field.type === 'text'
      ? say(`kitControl.${tool}.hint.${field.id}`)
      : unit
        ? say('kitControl.ui.unitHint', { unit })
        : '';
  const describedBy = problem ? `${id}-problem` : hint ? `${id}-hint` : undefined;
  const common = {
    id,
    className: box ? `${styles.input} ${styles.textarea}` : styles.input,
    value: text,
    spellCheck: false,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': describedBy,
  } as const;
  return (
    <div className={field.type === 'text' ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.entry}>
        {box ? (
          <textarea
            {...common}
            rows={field.type === 'text' ? field.rows : 1}
            onChange={(e) => props.onChange(e.target.value)}
          />
        ) : (
          <input
            {...common}
            type="text"
            inputMode={field.type === 'number' && !field.unit ? 'decimal' : undefined}
            autoComplete="off"
            onChange={(e) => props.onChange(e.target.value)}
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
          {problemText(problem)}
        </p>
      ) : (
        hint && (
          <span id={`${id}-hint`} className={styles.hint} hidden={field.type !== 'text'}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

function insertItems(c: InsertContext): MenuItemSpec[] {
  const done = (ok: boolean) => announce(say(ok ? 'kitControl.ui.inserted' : 'kitControl.ui.noPage'));
  const items: MenuItemSpec[] = [
    {
      id: 'answer',
      label: say('kitControl.ui.insertAnswer'),
      onSelect: () => done(sendToPage({ text: `${answerText(c)} ` })),
    },
    {
      id: 'equation',
      label: say('kitControl.ui.insertEquation'),
      onSelect: () => done(sendToPage({ math: { source: answerLatex(c), display: true } })),
    },
    {
      id: 'table',
      label: say('kitControl.ui.insertTable'),
      onSelect: () => done(sendToPage({ table: resultTable(c) })),
    },
  ];
  c.outcome.tables?.forEach((table, i) =>
    items.push({
      id: `table-${table.id}`,
      label: say('kitControl.ui.insertNamed', { name: say(`kitControl.${c.tool}.table.${table.id}`) }),
      onSelect: () => {
        const extra = extraTable(c, i);
        if (extra) done(sendToPage({ table: extra }));
      },
    }),
  );
  if (c.outcome.steps.length) {
    items.push({
      id: 'steps',
      label: say('kitControl.ui.insertSteps'),
      onSelect: () => done(sendToPage({ text: stepsHtml(c) })),
    });
  }
  c.outcome.plots?.forEach((plot, i) => {
    const name = say(`kitControl.${c.tool}.plot.${plot.id}`);
    items.push({
      id: `plot-${i}`,
      label: say('kitControl.ui.insertPicture', { name }),
      onSelect: () => done(sendToPage({ picture: pictureRequest(plotText(c, plot, PAGE), `${plot.id}.svg`, name) })),
    });
  });
  return items;
}

export function ToolPanel({ tool, spec }: { tool: string; spec: ToolSpec }) {
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...firstTexts(spec), ...load(tool, {}) }));
  const [system, setSystem] = useState<System>(() => (load<string>('system', 'si') === 'us' ? 'us' : 'si'));
  useEffect(() => save(tool, texts), [tool, texts]);
  useEffect(() => save('system', system), [system]);
  // Typing stays quick: a tool that takes a moment works on the texts once typing pauses.
  const settled = useDeferredValue(texts);
  const run = useMemo(() => runTool(spec, settled, system), [spec, settled, system]);
  const problems = new Map(run.ok ? [] : run.fields.map((one) => [one.field, one.problem] as const));
  const hasUnits = spec.fields.some((field) => field.type === 'number' && field.unit);
  const changeSystem = (next: System) => {
    if (next === system) return;
    setTexts(pinUnits(spec, texts, system, next));
    setSystem(next);
  };
  const pickExample = (id: string) => {
    const example = spec.examples?.find((one) => one.id === id);
    if (example) setTexts({ ...firstTexts(spec), ...example.texts });
  };
  const c: InsertContext | null = run.ok ? { tool, outcome: run.outcome, system, say } : null;
  const openInsert = (anchor: HTMLElement) => {
    if (c) void openMenu({ label: say('kitControl.ui.insertMenu'), items: insertItems(c), anchor });
  };
  return (
    <div className={styles.panel}>
      <p className={styles.lead}>{say(`kitControl.${tool}.lead`)}</p>
      {(hasUnits || spec.examples) && (
        <div className={styles.row}>
          {hasUnits && (
            <label className={styles.field}>
              <span>{say('kitControl.ui.units')}</span>
              <select
                className={styles.input}
                value={system}
                onChange={(event) => changeSystem(event.target.value as System)}
              >
                <option value="si">{say('kitControl.ui.si')}</option>
                <option value="us">{say('kitControl.ui.us')}</option>
              </select>
            </label>
          )}
          {spec.examples && (
            <label className={styles.field}>
              <span>{say('kitControl.ui.example')}</span>
              <select className={styles.input} value="" onChange={(event) => pickExample(event.target.value)}>
                <option value="">{say('kitControl.ui.exampleNone')}</option>
                {spec.examples.map((example) => (
                  <option key={example.id} value={example.id}>
                    {say(`kitControl.${tool}.example.${example.id}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <div className={styles.row}>
        {shownFields(spec, texts).map((field) => (
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
          {run.error ? problemText(run.error) : say('kitControl.ui.fixFields')}
        </p>
      )}
      {c && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
              {say('kitControl.ui.insert')}
            </Button>
          </div>
          <Results c={c} />
        </>
      )}
    </div>
  );
}
