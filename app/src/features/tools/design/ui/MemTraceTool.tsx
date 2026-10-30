// checks-disable-file modifiability, length: the tracer is one component that holds the run and the step

// The memory and pointer tracer: a short C++ snippet is run one statement at a time over a simulated memory, and each
// step shows the stack, the heap and every pointer as boxes and arrows, the output, and any warning. The picture is
// also a table, so nothing depends on seeing the arrows. This is a teaching model of a small part of C++, not a
// compiler, and the window says so.
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Button, announce, openMenu } from '../../../../ui';
import { PAGE, SCREEN } from '../kit/plot';
import { memorySvg, type MemLabels } from '../memDrawing';
import { run, type RunFailure, type RunResult, type Snapshot } from '../memRun';
import { traceRows, summaryText, variableRows } from '../memTrace';
import { pictureRequest, sendToPage } from './insert';
import { say } from './ToolPanel';
import { load, save } from './store';
import styles from './design.module.css';

const EXAMPLES = ['pointer', 'array', 'reference', 'leak', 'bounds', 'arithmetic', 'swap'] as const;
const SOURCES: Record<(typeof EXAMPLES)[number], string> = {
  pointer: 'int x = 5;\nint* p = &x;\n*p = 7;\ncout << x;',
  array: 'int a[3] = {1, 2, 3};\nint* q = a + 1;\n*q = 9;\ncout << a[1];',
  reference: 'int x = 7;\nint& r = x;\nr++;\ncout << x;',
  leak: 'int* h = new int(4);\nh = nullptr;',
  bounds: 'int b[2];\nb[0] = 1;\nb[2] = 1;',
  arithmetic: "cout << 7 / 2 << endl;\ncout << 'a' + 1 << endl;",
  swap: 'void swap(int& a, int& b) {\n  int t = a;\n  a = b;\n  b = t;\n}\nint main() {\n  int x = 1;\n  int y = 2;\n  swap(x, y);\n  cout << x << y;\n}',
};

const labels = (): MemLabels => ({
  stack: say('kitDesign.memtrace.stack'),
  heap: say('kitDesign.memtrace.heap'),
  globals: say('kitDesign.memtrace.globals'),
  freed: say('kitDesign.memtrace.freed'),
  nullPointer: say('kitDesign.memtrace.null'),
});

const failureText = (f: RunFailure): string =>
  say(`kitDesign.memtrace.failure.${f.kind}`, { line: f.line, detail: f.detail });

function Listing(props: { source: string; line: number; warned: ReadonlySet<number> }) {
  return (
    <ol className={styles.listing} aria-label={say('kitDesign.memtrace.code')}>
      {props.source.split(/\r?\n/).map((text, i) => (
        <li
          key={i}
          value={i + 1}
          className={`${styles.codeLine} ${props.line === i + 1 ? styles.codeNow : ''}`}
          aria-current={props.line === i + 1 ? 'step' : undefined}
        >
          <code>{text === '' ? ' ' : text}</code>
          {props.warned.has(i + 1) && <span className={styles.warnMark}>{say('kitDesign.memtrace.warnMark')}</span>}
        </li>
      ))}
    </ol>
  );
}

function Variables({ snap }: { snap: Snapshot }) {
  const rows = variableRows(snap, say('kitDesign.memtrace.null'));
  if (rows.length === 0) return <p className={styles.hint}>{say('kitDesign.memtrace.noVariables')}</p>;
  return (
    <div className={styles.scroll} tabIndex={0} role="region" aria-label={say('kitDesign.memtrace.variables')}>
      <table className={styles.table}>
        <thead>
          <tr>
            {['where', 'name', 'type', 'address', 'value'].map((c) => (
              <th key={c} scope="col">
                {say(`kitDesign.memtrace.col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                {r.region === 'heap'
                  ? say('kitDesign.memtrace.heap')
                  : r.region === 'global'
                    ? say('kitDesign.memtrace.globals')
                    : `${r.scope}()`}
              </td>
              <td className={styles.number}>{r.name}</td>
              <td className={styles.number}>{r.type}</td>
              <td className={styles.number}>{r.addr}</td>
              <td className={styles.number}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Trace(props: { source: string; result: RunResult }) {
  const { result, source } = props;
  const [at, setAt] = useState(0);
  const snap = result.snapshots[Math.min(at, result.snapshots.length - 1)]!;
  const last = result.snapshots.length - 1;
  const warnings = result.warnings.slice(0, snap.warnings);
  const warned = new Set(warnings.map((w) => w.line));
  const alt = say('kitDesign.memtrace.alt', { step: at + 1, total: result.snapshots.length, line: snap.line });
  const svg = useMemo(() => memorySvg(snap, SCREEN, labels(), alt), [snap, alt]);
  const go = (to: number) => {
    const next = Math.min(last, Math.max(0, to));
    setAt(next);
    const s = result.snapshots[next]!;
    announce(say('kitDesign.memtrace.stepAnnounce', { step: next + 1, total: result.snapshots.length, line: s.line }));
  };
  const keys = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    const table: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: last };
    const to = table[event.key];
    if (to === undefined) return;
    event.preventDefault();
    go(to);
  };
  const put = (picture: string, name: string, description: string) => {
    const took = sendToPage({ picture: pictureRequest(picture, name, description) });
    announce(say(took ? 'kitDesign.ui.inserted' : 'kitDesign.ui.noPage'));
  };
  const insert = (anchor: HTMLElement) => {
    const nullWord = say('kitDesign.memtrace.null');
    void openMenu({
      label: say('kitDesign.ui.insertMenu'),
      anchor,
      items: [
        {
          id: 'snapshot',
          label: say('kitDesign.memtrace.insertSnapshot'),
          onSelect: () => put(memorySvg(snap, PAGE, labels(), alt), `memory-${at + 1}.svg`, alt),
        },
        {
          id: 'timeline',
          label: say('kitDesign.memtrace.insertTimeline'),
          onSelect: () => {
            result.snapshots.slice(0, 12).forEach((s, i) => {
              const text = say('kitDesign.memtrace.alt', { step: i + 1, total: result.snapshots.length, line: s.line });
              put(memorySvg(s, PAGE, labels(), text), `memory-${i + 1}.svg`, text);
            });
          },
        },
        {
          id: 'table',
          label: say('kitDesign.memtrace.insertTable'),
          onSelect: () => {
            const header = ['step', 'line', 'code', 'state'].map((c) => say(`kitDesign.memtrace.traceCol.${c}`));
            const took = sendToPage({ table: { header, rows: traceRows(result, source, nullWord) } });
            announce(say(took ? 'kitDesign.ui.inserted' : 'kitDesign.ui.noPage'));
          },
        },
      ],
    });
  };
  return (
    // The arrow keys step through the run while focus is on the step controls.
    <div className={styles.panel} onKeyDown={keys}>
      <div className={styles.buttons}>
        <Button onClick={() => go(0)} disabled={at === 0}>
          {say('kitDesign.memtrace.first')}
        </Button>
        <Button onClick={() => go(at - 1)} disabled={at === 0}>
          {say('kitDesign.memtrace.previous')}
        </Button>
        <Button variant="primary" onClick={() => go(at + 1)} disabled={at >= last}>
          {say('kitDesign.memtrace.next')}
        </Button>
        <Button onClick={() => go(last)} disabled={at >= last}>
          {say('kitDesign.memtrace.lastStep')}
        </Button>
        <Button aria-haspopup="menu" onClick={(event) => insert(event.currentTarget)}>
          {say('kitDesign.ui.insert')}
        </Button>
      </div>
      <label className={styles.field}>
        <span>{say('kitDesign.memtrace.stepLabel', { step: at + 1, total: result.snapshots.length })}</span>
        <input
          type="range"
          min={0}
          max={last}
          value={at}
          onChange={(event) => go(Number(event.target.value))}
          aria-valuetext={say('kitDesign.memtrace.stepAnnounce', {
            step: at + 1,
            total: result.snapshots.length,
            line: snap.line,
          })}
        />
      </label>
      <Listing source={source} line={snap.kind === 'end' ? 0 : snap.line} warned={warned} />
      <p role="status" className={styles.hint}>
        {say(`kitDesign.memtrace.kind.${snap.kind}`, { line: snap.line })}{' '}
        {summaryText(snap, say('kitDesign.memtrace.null'))}
      </p>
      <figure className={`${styles.figure} ${styles.natural}`}>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </figure>
      <section className={styles.section}>
        <h3 className={styles.heading}>{say('kitDesign.memtrace.variables')}</h3>
        <Variables snap={snap} />
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>{say('kitDesign.memtrace.output')}</h3>
        <pre className={`${styles.mono} ${styles.code}`}>
          {snap.output === '' ? say('kitDesign.memtrace.noOutput') : snap.output}
        </pre>
      </section>
      {warnings.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.heading}>{say('kitDesign.memtrace.warnings')}</h3>
          <ul className={styles.notes}>
            {warnings.map((w, i) => (
              <li key={i}>
                {say('kitDesign.memtrace.warnLine', {
                  line: w.line,
                  text: say(`kitDesign.memtrace.warn.${w.kind}`, { detail: w.detail ?? '' }),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
      {at === last && result.stop && (
        <p className={styles.problem} role="status">
          {say(`kitDesign.memtrace.stop.${result.stop.kind}`, { line: result.stop.line, detail: result.stop.detail })}
        </p>
      )}
      {at === last && result.truncated && <p className={styles.hint}>{say('kitDesign.memtrace.truncated')}</p>}
    </div>
  );
}

export default function MemTraceTool() {
  const id = useId();
  const [source, setSource] = useState(() => load('memtrace.source', SOURCES.pointer));
  const [shown, setShown] = useState<{ source: string; result: RunResult | RunFailure } | null>(null);
  const start = () => {
    save('memtrace.source', source);
    const result = run(source);
    setShown({ source, result });
    announce(
      say(result.ok ? 'kitDesign.memtrace.ran' : 'kitDesign.memtrace.failed', {
        count: result.ok ? result.snapshots.length : 0,
      }),
    );
  };
  const example = (name: string) => {
    const text = SOURCES[name as keyof typeof SOURCES];
    if (text === undefined) return;
    setSource(text);
    save('memtrace.source', text);
    setShown(null);
  };
  return (
    <div className={styles.panel}>
      <p className={styles.hint}>{say('kitDesign.memtrace.about')}</p>
      <p className={styles.hint}>{say('kitDesign.memtrace.subset')}</p>
      <label className={styles.field}>
        <span>{say('kitDesign.ui.example')}</span>
        <select className={styles.input} value="" onChange={(event) => example(event.target.value)}>
          <option value="">{say('kitDesign.ui.exampleNone')}</option>
          {EXAMPLES.map((name) => (
            <option key={name} value={name}>
              {say(`kitDesign.memtrace.example.${name}`)}
            </option>
          ))}
        </select>
      </label>
      <div className={`${styles.field} ${styles.wide}`}>
        <label htmlFor={id}>{say('kitDesign.memtrace.source')}</label>
        <textarea
          id={id}
          className={`${styles.input} ${styles.textarea}`}
          rows={9}
          value={source}
          spellCheck={false}
          onChange={(event) => {
            setSource(event.target.value);
            setShown(null);
          }}
        />
      </div>
      <div className={styles.buttons}>
        <Button variant="primary" onClick={start}>
          {say('kitDesign.memtrace.run')}
        </Button>
      </div>
      {shown && !shown.result.ok && (
        <p className={styles.problem} role="status">
          {failureText(shown.result)}
        </p>
      )}
      {shown?.result.ok && <Trace key={shown.source} source={shown.source} result={shown.result} />}
    </div>
  );
}
