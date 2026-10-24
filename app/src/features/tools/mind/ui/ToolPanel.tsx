// One tool of the kit: its fields, ready-made examples, the results, and the Insert menu. The typed texts are kept
// on this device for each tool. Results follow the fields a moment after typing stops, so a long computation does
// not run on every key.
import { useEffect, useId, useMemo, useState, type ComponentType } from 'react';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import { PAGE } from '../kit/plot';
import { firstTexts, runTool, shownFields, type Field, type ToolSpec } from '../kit/spec';
import type { MindError } from '../kit/types';
import {
  answerLatex,
  answerText,
  extraTable,
  maybeSay,
  pictureRequest,
  pictureSvg,
  resultTable,
  say,
  sendToPage,
  stepsHtml,
  toolKey,
  type InsertContext,
} from './insert';
import { Results } from './Results';
import styles from './mind.module.css';

/** What a tool's own extra part gets: the field texts, and a way to set one. */
export interface ExtraProps {
  readonly texts: Readonly<Record<string, string>>;
  setText(id: string, text: string): void;
}

const PREFIX = 'opennote.tools.kitMind.';

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

export const errorText = (error: MindError): string => say(`kitMind.error.${error.code}`, error.vars);

function FieldInput(props: {
  tool: string;
  field: Field;
  text: string;
  problem: MindError | undefined;
  onChange: (text: string) => void;
}) {
  const { tool, field, text, problem } = props;
  const id = useId();
  const label = say(`kitMind.${tool}.field.${field.id}`);
  if (field.type === 'choice') {
    return (
      <div className={styles.field}>
        <label htmlFor={id}>{label}</label>
        <select id={id} className={styles.input} value={text} onChange={(event) => props.onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {say(`kitMind.${tool}.option.${option}`)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const hint = maybeSay(`kitMind.${tool}.hint.${field.id}`);
  const described = [problem ? `${id}-problem` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
  const common = {
    id,
    className: field.type === 'text' ? `${styles.input} ${styles.textarea}` : styles.input,
    value: text,
    spellCheck: false,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': described || undefined,
  } as const;
  const wide = field.type === 'text' || field.type === 'line';
  return (
    <div className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label htmlFor={id}>{label}</label>
      {field.type === 'text' ? (
        <textarea {...common} rows={field.rows} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          type="text"
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          autoComplete="off"
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {hint && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
      {problem && (
        <p id={`${id}-problem`} className={styles.problem}>
          {errorText(problem)}
        </p>
      )}
    </div>
  );
}

function insertItems(c: InsertContext): MenuItemSpec[] {
  const done = (ok: boolean) => announce(say(ok ? 'kitMind.ui.inserted' : 'kitMind.ui.noPage'));
  const items: MenuItemSpec[] = [
    {
      id: 'answer',
      label: say('kitMind.ui.insertAnswer'),
      onSelect: () => done(sendToPage({ text: `${answerText(c)} ` })),
    },
    {
      id: 'equation',
      label: say('kitMind.ui.insertEquation'),
      onSelect: () => done(sendToPage({ math: { source: answerLatex(c), display: true } })),
    },
    { id: 'table', label: say('kitMind.ui.insertTable'), onSelect: () => done(sendToPage({ table: resultTable(c) })) },
  ];
  if (c.outcome.steps.length > 0)
    items.push({
      id: 'steps',
      label: say('kitMind.ui.insertSteps'),
      onSelect: () => done(sendToPage({ text: stepsHtml(c) })),
    });
  c.outcome.tables?.forEach((table, i) =>
    items.push({
      id: `table-${table.id}`,
      label: say('kitMind.ui.insertExtra', { name: say(toolKey(c, `table.${table.id}`)) }),
      onSelect: () => {
        const extra = extraTable(c, i);
        if (extra) done(sendToPage({ table: extra }));
      },
    }),
  );
  c.outcome.pictures?.forEach((picture) => {
    const alt = say(toolKey(c, `picture.${picture.id}`));
    items.push({
      id: `picture-${picture.id}`,
      label: say('kitMind.ui.insertPicture', { name: alt }),
      onSelect: () =>
        done(sendToPage({ picture: pictureRequest(pictureSvg(c, picture, PAGE), `${c.tool}-${picture.id}.svg`, alt) })),
    });
  });
  return items;
}

/** The texts a moment after they stop changing. */
function useSettled<T>(value: T, delay = 180): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function ToolPanel({
  tool,
  spec,
  extra: Extra,
}: {
  tool: string;
  spec: ToolSpec;
  extra?: ComponentType<ExtraProps>;
}) {
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...firstTexts(spec), ...load(tool, {}) }));
  useEffect(() => save(tool, texts), [tool, texts]);
  const settled = useSettled(texts);
  const run = useMemo(() => runTool(spec, settled), [spec, settled]);
  const now = useMemo(() => ({ ...firstTexts(spec), ...texts }), [spec, texts]);
  const problems = run.ok ? new Map<string, MindError>() : run.problems;
  const setText = (id: string, text: string) => setTexts((current) => ({ ...current, [id]: text }));
  const pickExample = (id: string) => {
    const example = spec.examples?.find((one) => one.id === id);
    if (example) setTexts({ ...firstTexts(spec), ...example.values });
  };
  const openInsert = (anchor: HTMLElement) => {
    if (!run.ok) return;
    void openMenu({ label: say('kitMind.ui.insertMenu'), items: insertItems({ tool, outcome: run.outcome }), anchor });
  };
  return (
    <div className={styles.panel}>
      {spec.examples && (
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor={`${tool}-example`}>{say('kitMind.ui.example')}</label>
            <select
              id={`${tool}-example`}
              className={styles.input}
              value=""
              onChange={(event) => pickExample(event.target.value)}
            >
              <option value="">{say('kitMind.ui.exampleNone')}</option>
              {spec.examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {say(`kitMind.${tool}.example.${example.id}`)}
                </option>
              ))}
            </select>
          </div>
          <Button variant="quiet" onClick={() => setTexts(firstTexts(spec))}>
            {say('kitMind.ui.reset')}
          </Button>
        </div>
      )}
      <div className={styles.row}>
        {shownFields(spec, now).map((field) => (
          <FieldInput
            key={field.id}
            tool={tool}
            field={field}
            text={now[field.id] ?? field.first}
            problem={problems.get(field.id)}
            onChange={(text) => setText(field.id, text)}
          />
        ))}
      </div>
      {Extra && <Extra texts={now} setText={setText} />}
      {!run.ok && (
        <p className={styles.problem} role="status">
          {run.error ? errorText(run.error) : say('kitMind.ui.fixFields')}
        </p>
      )}
      {run.ok && (
        <>
          <div className={styles.buttons}>
            <Button variant="primary" aria-haspopup="menu" onClick={(event) => openInsert(event.currentTarget)}>
              {say('kitMind.ui.insert')}
            </Button>
          </div>
          <Results tool={tool} outcome={run.outcome} />
        </>
      )}
    </div>
  );
}
