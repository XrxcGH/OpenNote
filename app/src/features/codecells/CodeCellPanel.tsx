// A code cell (docs/help/code-cells.md): code in the studio's editor, a Run button, and what the code printed. The code
// runs only when the person presses Run, in the run core's sandbox worker with no network, files, or page, and stops
// at the time and memory limits or at Stop. Output is shown as text only and is not saved with the page.
//
// The editor, the checkers, and completion are lazy chunks of the code studio: a page with no code cell never loads
// them, and a page with one loads them after the cell is drawn.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Play } from '@phosphor-icons/react/dist/csr/Play';
import { Stop } from '@phosphor-icons/react/dist/csr/Stop';
import { getSettings, useSettings } from '../../state/settings';
import { codeStudioPython } from '../../strings/en/codeStudio/python';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import type { CodeEditor, Stream } from '../codestudio';
import { explainSandboxError } from './explain';
import { FILE_NAMES, LANGUAGES, LIMITS, minEditorOf } from './model';
import type { CodeLanguage, PythonEngine } from './model';
import type { RunHandle, RunResult } from './run';
import { starterOf } from './starters';
import styles from './codecell.module.css';

/** What the cell saves: the block patches its data with it. */
export interface CellChange {
  language: CodeLanguage;
  source: string;
  /** The format version the cell needs (1 or 2). */
  minEditor: 1 | 2;
  /** The Python engine when it is not the quick one; null clears it. */
  runtime: PythonEngine | null;
}

interface Props {
  language: CodeLanguage;
  engine?: PythonEngine;
  source: string;
  readOnly: boolean;
  onChange(next: CellChange): void;
  announce(text: string): void;
  /**
   * Converts the cell to a code project and opens the studio (the page provides it when the studio is on). It gets
   * the cell as it is now, because the page's copy lags the typing by a moment.
   */
  onOpenStudio?(cell: { language: CodeLanguage; engine: PythonEngine; source: string }): void;
}

interface Piece {
  stream: Stream;
  text: string;
}

const MEGABYTES = String(LIMITS.memoryBytes / (1024 * 1024));

/** The cell's limits: the time limit is Settings, then Code, as in the studio. */
function limitsNow(): typeof LIMITS {
  return { ...LIMITS, timeMs: getSettings().code.timeLimitSeconds * 1000 };
}

function statusText(result: RunResult, seconds: string): string {
  switch (result.status) {
    case 'ok':
      return t('codeCells.status.ok', { seconds: (result.elapsedMs / 1000).toFixed(2) });
    case 'time':
      return t('codeCells.status.time', { seconds });
    case 'memory':
      return t('codeCells.status.memory', { megabytes: MEGABYTES });
    case 'failed':
      if (result.message === 'runtime') return t('codeCells.status.runtime');
      if (result.message === codeStudioPython.fullMissing) return t('codeCells.status.pack');
      if (result.message === 'pack-missing') return t('codeStudio.cpp.packMissing');
      return t('codeCells.status.failed');
    default:
      return t(`codeCells.status.${result.status}`);
  }
}

function changeOf(language: CodeLanguage, engine: PythonEngine, source: string): CellChange {
  const python = language === 'python';
  return {
    language,
    source,
    minEditor: minEditorOf(language, python ? engine : 'python-quick'),
    runtime: python && engine !== 'python-quick' ? engine : null,
  };
}

interface Checker {
  update(text: string, language: CodeLanguage): void;
}

export function CodeCellPanel({
  language,
  engine = 'python-quick',
  source,
  readOnly,
  onChange,
  announce,
  onOpenStudio,
  // checks-disable-next-line modifiability: one component whose parts share the run's state
}: Props) {
  const [text, setText] = useState(source);
  const seconds = String(useSettings((all) => all.code.timeLimitSeconds));
  const [output, setOutput] = useState<Piece[]>([]);
  const [status, setStatus] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState<RunHandle | null>(null);
  const sent = useRef(source);
  const starting = useRef(false);
  const helpId = useId();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<CodeEditor | null>(null);
  const checker = useRef<Checker | null>(null);
  // The latest values for the editor's callbacks, which are made once.
  const latest = useRef({ running, language, readOnly, text });
  useEffect(() => {
    latest.current = { running, language, readOnly, text };
  });

  // The editor and its helpers load after the cell is drawn.
  useEffect(() => {
    let gone = false;
    let cleanup = (): void => undefined;
    void (async () => {
      const studio = await import('../codestudio');
      const { createCodeEditor } = await studio.loadCodeEditor();
      if (gone || !host.current) return;
      const made = createCodeEditor(host.current, {
        language: latest.current.language,
        text: latest.current.text,
        readOnly: latest.current.readOnly,
        label: t('codeCells.code'),
        file: FILE_NAMES[latest.current.language],
        onChange: (next) => setText(next),
        onEscape: () => {
          const handle = latest.current.running;
          if (!handle) return false;
          handle.stop();
          return true;
        },
      });
      editor.current = made;
      host.current.querySelector('.cm-content')?.setAttribute('aria-describedby', helpId);
      cleanup = () => made.destroy();
      const [{ attachCompletion }, { createDiagnostics }] = await Promise.all([
        studio.loadCompletion(),
        studio.loadDiagnostics(),
      ]);
      if (gone) return;
      const detach = attachCompletion(made);
      let version = 0;
      const service = createDiagnostics({ publish: (_file, items) => made.showProblems(items) });
      const update = (next: string, lang: CodeLanguage) =>
        service.update({ file: FILE_NAMES[lang], version: (version += 1), language: lang, text: next });
      checker.current = { update };
      update(made.getText(), latest.current.language);
      cleanup = () => {
        checker.current = null;
        detach();
        service.dispose();
        made.destroy();
      };
    })();
    return () => {
      gone = true;
      editor.current = null;
      cleanup();
    };
  }, [helpId]);

  useEffect(() => {
    void editor.current?.setLanguage(language);
    editor.current?.setReadOnly(readOnly);
  }, [language, readOnly]);

  // Undo, redo, or another window changed the block.
  useEffect(() => {
    if (source !== sent.current) {
      sent.current = source;
      setText(source);
      if (editor.current && editor.current.getText() !== source) editor.current.setText(source);
    }
  }, [source]);

  // The checkers wait for a typing pause themselves (the scheduler's layers).
  useEffect(() => {
    checker.current?.update(text, language);
  }, [text, language]);

  // Save the text a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text !== sent.current) {
        sent.current = text;
        onChange(changeOf(language, engine, text));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [text, language, engine, onChange]);

  // A cell still running when the block goes away is stopped.
  useEffect(() => () => running?.stop(), [running]);

  const run = async () => {
    if (running || starting.current) return;
    starting.current = true;
    try {
      const { runCode } = await import('./run');
      const pieces: Piece[] = [];
      setOutput([]);
      setTruncated(false);
      setFailed(false);
      setStatus(t('codeCells.status.starting', { language: t(`codeCells.languages.${language}`) }));
      const handle = runCode(
        language,
        editor.current?.getText() ?? text,
        (stream, chunk) => {
          const last = pieces.at(-1);
          if (last?.stream === stream) last.text += chunk;
          else pieces.push({ stream, text: chunk });
          setOutput([...pieces]);
        },
        limitsNow(),
        () => setStatus(t('codeCells.status.running')),
        engine,
      );
      setRunning(handle);
      const result = await handle.done;
      setRunning(null);
      setTruncated(result.truncated);
      setFailed(result.status === 'failed');
      const said = statusText(result, String(limitsNow().timeMs / 1000));
      setStatus(said);
      announce(said);
    } finally {
      starting.current = false;
    }
  };

  // Ctrl+Enter runs the cell. It is caught before the editor, which would add a blank line.
  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      void run();
    }
  };

  const change = (next: CodeLanguage, nextEngine: PythonEngine) => {
    // The other language's example becomes this one's; the person's own code stays as it is.
    const now = editor.current?.getText() ?? text;
    const swapped = now === starterOf(language) ? starterOf(next) : now;
    sent.current = swapped;
    setText(swapped);
    if (swapped !== now) editor.current?.setText(swapped);
    onChange(changeOf(next, nextEngine, swapped));
  };

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <label className={styles.field}>
          {t('codeCells.language')}
          <select
            value={language}
            disabled={readOnly || running !== null}
            onChange={(event) => change(event.target.value as CodeLanguage, engine)}
          >
            {LANGUAGES.map((one) => (
              <option key={one} value={one}>
                {t(`codeCells.languages.${one}`)}
              </option>
            ))}
          </select>
        </label>
        {language === 'python' ? (
          <label className={styles.field}>
            {t('codeCells.engine')}
            <select
              value={engine}
              disabled={readOnly || running !== null}
              onChange={(event) => change(language, event.target.value as PythonEngine)}
            >
              {(['python-quick', 'python-full'] as const).map((one) => (
                <option key={one} value={one}>
                  {t(`codeCells.engines.${one}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {running ? (
          <Button variant="danger" onClick={() => running.stop()}>
            <Stop aria-hidden /> {t('codeCells.stop')}
          </Button>
        ) : (
          <Button variant="primary" aria-keyshortcuts="Control+Enter" onClick={() => void run()}>
            <Play aria-hidden weight="fill" /> {t('codeCells.run')}
          </Button>
        )}
        <Button
          variant="quiet"
          disabled={output.length === 0 || running !== null}
          onClick={() => {
            setOutput([]);
            setStatus('');
            setTruncated(false);
            setFailed(false);
          }}
        >
          {t('codeCells.clear')}
        </Button>
        {onOpenStudio && !readOnly ? (
          <Button
            variant="quiet"
            onClick={() => onOpenStudio({ language, engine, source: editor.current?.getText() ?? text })}
          >
            {t('codeCells.openStudio')}
          </Button>
        ) : null}
      </div>
      {/* The editor draws itself into this box; its own label names it for assistive technology. */}
      <div ref={host} className={styles.editor} onKeyDownCapture={onKeyDownCapture} />
      <p className={styles.help}>
        <span id={helpId}>{t('codeCells.codeHelp')}</span> {t('codeCells.safety', { seconds, megabytes: MEGABYTES })}
      </p>
      <p className={styles.status} role="status">
        {status}
      </p>
      {output.length > 0 || (status !== '' && !running && !failed) ? (
        <pre className={styles.output} role="log" aria-live="off" aria-label={t('codeCells.output')} tabIndex={0}>
          {output.length === 0
            ? t('codeCells.noOutput')
            : output.map((piece, index) => (
                <span key={index} className={piece.stream === 'err' ? styles.err : undefined}>
                  {piece.stream === 'err' ? explainSandboxError(piece.text) : piece.text}
                </span>
              ))}
          {truncated ? <span className={styles.err}>{`\n${t('codeCells.status.truncated')}`}</span> : null}
        </pre>
      ) : null}
    </div>
  );
}
