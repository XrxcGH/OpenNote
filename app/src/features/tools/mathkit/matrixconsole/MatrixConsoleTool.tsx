// The matrix console: type MATLAB-style commands or a short script and see the answers as MATLAB would print them.
// Variables last for the session. Nothing is installed or sent anywhere: the commands run in this window.
import { useEffect, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { insertIntoPage } from '../../ui/insert';
import { Choice, LinePlot, Note, say, useStored } from '../ui/parts';
import styles from '../ui/mathkit.module.css';
import type { Figure } from './ctx';
import { EXAMPLES } from './examples';
import { figureSvg, svgToPngBytes } from './figureSvg';
import { Session, type Entry } from './interp';

const session = new Session();
let history: Entry[] = [];
let commands: string[] = [];

/** Starts a fresh console, for a test. */
export function resetConsole(): void {
  session.reset();
  history = [];
  commands = [];
}

const word = (key: string, vars?: Record<string, string>) => say(key, vars);

/** An entry as the plain text a page would hold. */
export function entryText(e: Entry): string[] {
  switch (e.kind) {
    case 'in':
      return e.text.split('\n').map((l) => `>> ${l}`);
    case 'out':
      return e.lines;
    case 'err':
      return [word('kitMath.console.errorPrefix') + word(`kitMath.error.${e.code}`, { detail: e.detail })];
    case 'note':
      return [word(`kitMath.console.note.${e.key}`, e.vars)];
    default:
      return [];
  }
}

function PlotEntry({ figure }: { figure: Figure }) {
  const label = [figure.title, t('kitMath.console.plotLabel', { n: figure.series.length })].filter(Boolean).join(': ');
  return (
    <figure className={styles.section}>
      <LinePlot
        label={label}
        logx={figure.logx}
        logy={figure.logy}
        series={figure.series.map((s, i) => ({
          points: s.x.map((x, k): [number, number] => [x, s.y[k]]),
          dots: s.dots,
          tone: i,
        }))}
      />
      <figcaption className={styles.note}>
        {[
          figure.title,
          figure.xlabel && `x: ${figure.xlabel}`,
          figure.ylabel && `y: ${figure.ylabel}`,
          figure.series.length > 1 ? figure.series.map((s) => s.name).join(', ') : '',
        ]
          .filter(Boolean)
          .join(' | ')}
      </figcaption>
    </figure>
  );
}

function Transcript({ entries }: { entries: readonly Entry[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = end.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [entries]);
  return (
    <div className={styles.console} role="log" aria-label={t('kitMath.console.transcript')} tabIndex={0}>
      {entries.map((e, i) =>
        e.kind === 'plot' ? (
          <PlotEntry key={i} figure={e.figure} />
        ) : e.kind === 'clear' ? null : (
          <div key={i} className={e.kind === 'err' ? styles.consoleError : e.kind === 'note' ? styles.note : undefined}>
            {entryText(e).join('\n')}
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}

function Workspace({ rows }: { rows: ReturnType<Session['workspace']> }) {
  return (
    <details className={styles.section}>
      <summary>{t('kitMath.console.workspace', { n: rows.length })}</summary>
      {rows.length === 0 ? (
        <Note>{t('kitMath.console.workspaceEmpty')}</Note>
      ) : (
        <div className={styles.scroll} tabIndex={0} role="region" aria-label={t('kitMath.console.workspaceCaption')}>
          <table className={styles.table}>
            <caption>{t('kitMath.console.workspaceCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('kitMath.console.colName')}</th>
                <th scope="col">{t('kitMath.console.colSize')}</th>
                <th scope="col">{t('kitMath.console.colClass')}</th>
                <th scope="col">{t('kitMath.console.colValue')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.size}</td>
                  <td>{r.kind}</td>
                  <td>{r.preview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

const done = (ok: boolean) => announce(t(ok ? 'kitMath.ui.inserted' : 'kitMath.ui.noPage'));

async function insertPlot(figure: Figure): Promise<void> {
  const description = t('kitMath.console.plotLabel', { n: figure.series.length });
  const svg = figureSvg(figure, description);
  if (!svg) return;
  try {
    const bytes = await svgToPngBytes(svg);
    done(
      insertIntoPage({
        picture: {
          bytes,
          name: 'plot.png',
          alt: [figure.title, description].filter(Boolean).join(': '),
          mime: 'image/png',
        },
      }),
    );
  } catch {
    announce(t('kitMath.console.plotFailed'));
  }
}

function lastMatrixTable(): { header: string[]; rows: string[][] } | null {
  const v = session.vars.get('ans') ?? [...session.vars.values()].pop();
  if (!v || v.kind !== 'mat' || v.d.length < 2 || v.str !== undefined) return null;
  const header = Array.from({ length: v.c }, (_, j) => String(j + 1));
  const rows = Array.from({ length: v.r }, (_, i) =>
    v.d.slice(i * v.c, (i + 1) * v.c).map((x) => String(Number(x.toPrecision(10)))),
  );
  return { header, rows };
}

function InsertButtons({ entries }: { entries: readonly Entry[] }) {
  const lastPlot = [...entries].reverse().find((e) => e.kind === 'plot');
  const table = lastMatrixTable();
  const transcript = entries.flatMap(entryText).join('\n');
  return (
    <div className={styles.actions}>
      <Button
        variant="quiet"
        disabled={!transcript}
        onClick={() => done(insertIntoPage({ text: `\`\`\`\n${transcript}\n\`\`\`` }))}
      >
        {t('kitMath.console.insertTranscript')}
      </Button>
      {table ? (
        <Button variant="quiet" onClick={() => done(insertIntoPage({ table }))}>
          {t('kitMath.console.insertMatrix')}
        </Button>
      ) : null}
      {lastPlot && lastPlot.kind === 'plot' ? (
        <Button variant="quiet" onClick={() => void insertPlot(lastPlot.figure)}>
          {t('kitMath.console.insertPlot')}
        </Button>
      ) : null}
    </div>
  );
}

export default function MatrixConsoleTool() {
  const [prefs, setPrefs] = useStored('console', { explain: false });
  const [entries, setEntries] = useState<Entry[]>(history);
  const [input, setInput] = useState('');
  const [back, setBack] = useState(-1);
  const [workspace, setWorkspace] = useState(() => session.workspace());
  const box = useRef<HTMLTextAreaElement>(null);
  const apply = (added: Entry[]) => {
    const cleared = added.findIndex((e) => e.kind === 'clear');
    history = [...(cleared >= 0 ? [] : history), ...(cleared >= 0 ? added.slice(cleared + 1) : added)].slice(-400);
    setEntries(history);
    setWorkspace(session.workspace());
  };
  const run = () => {
    const source = input.trim();
    if (!source) return;
    session.explain = prefs.explain;
    commands = [...commands, source].slice(-100);
    setBack(-1);
    setInput('');
    apply(session.run(source));
    box.current?.focus();
  };
  const onKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      run();
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !input.includes('\n')) {
      const next = event.key === 'ArrowUp' ? Math.min(back + 1, commands.length - 1) : back - 1;
      if (commands.length === 0) return;
      event.preventDefault();
      setBack(next);
      setInput(next < 0 ? '' : commands[commands.length - 1 - next]);
    }
  };
  return (
    <div className={styles.panel}>
      <Note>{t('kitMath.console.assumptions')}</Note>
      <Transcript entries={entries} />
      <div className={styles.field}>
        <label htmlFor="kitmath-console-input">{t('kitMath.console.input')}</label>
        <textarea
          id="kitmath-console-input"
          ref={box}
          className={`${styles.input} ${styles.mono} ${styles.textarea}`}
          rows={3}
          value={input}
          spellCheck={false}
          aria-description={t('kitMath.console.hint')}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className={styles.actions}>
        <Button variant="primary" onClick={run}>
          {t('kitMath.console.run')}
        </Button>
        <Button variant="quiet" onClick={() => apply([{ kind: 'clear' }])}>
          {t('kitMath.console.clearScreen')}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            session.reset();
            apply([{ kind: 'clear' }]);
          }}
        >
          {t('kitMath.console.clearAll')}
        </Button>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={prefs.explain}
            onChange={(event) => setPrefs({ explain: event.target.checked })}
          />
          {t('kitMath.console.explain')}
        </label>
        <Choice
          label={t('kitMath.console.examples')}
          value=""
          options={[
            { value: '', label: t('kitMath.console.exampleNone') },
            ...EXAMPLES.map((x) => ({ value: x.id, label: say(`kitMath.console.example.${x.id}`) })),
          ]}
          onChange={(id) => setInput(EXAMPLES.find((x) => x.id === id)?.code ?? input)}
        />
      </div>
      <Note>{t('kitMath.console.hint')}</Note>
      <InsertButtons entries={entries} />
      <Workspace rows={workspace} />
    </div>
  );
}
