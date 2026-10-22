// A code cell (docs/help/code-cells.md): Python or JavaScript text, a Run button, and what the code printed. The code
// runs only when the person presses Run, in a sandbox worker with no network, files, or page (sandbox/), and stops at
// the time and memory limits or at Stop. Output is shown as text only and is not saved with the page.
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Play } from '@phosphor-icons/react/dist/csr/Play';
import { Stop } from '@phosphor-icons/react/dist/csr/Stop';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { LANGUAGES, LIMITS } from './sandbox/protocol';
import type { CodeLanguage, Stream } from './sandbox/protocol';
import type { RunHandle, RunResult } from './sandbox/run';
import { indentAt } from './indent';
import styles from './codecell.module.css';

interface Props {
  language: CodeLanguage;
  source: string;
  readOnly: boolean;
  onChange(next: { language: CodeLanguage; source: string }): void;
  announce(text: string): void;
}

interface Piece {
  stream: Stream;
  text: string;
}

const SECONDS = String(LIMITS.timeMs / 1000);
const MEGABYTES = String(LIMITS.memoryBytes / (1024 * 1024));

function statusText(result: RunResult): string {
  switch (result.status) {
    case 'ok':
      return t('codeCells.status.ok', { seconds: (result.elapsedMs / 1000).toFixed(2) });
    case 'time':
      return t('codeCells.status.time', { seconds: SECONDS });
    case 'memory':
      return t('codeCells.status.memory', { megabytes: MEGABYTES });
    default:
      return t(`codeCells.status.${result.status}`);
  }
}

// checks-disable-next-line modifiability: one component whose parts share the run's state
export function CodeCellPanel({ language, source, readOnly, onChange, announce }: Props) {
  const [text, setText] = useState(source);
  const [output, setOutput] = useState<Piece[]>([]);
  const [status, setStatus] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [running, setRunning] = useState<RunHandle | null>(null);
  const sent = useRef(source);
  const escaped = useRef(false);
  const helpId = useId();

  // Undo, redo, or another window changed the block.
  useEffect(() => {
    if (source !== sent.current) {
      sent.current = source;
      setText(source);
    }
  }, [source]);

  // Save the text a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text !== sent.current) {
        sent.current = text;
        onChange({ language, source: text });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [text, language, onChange]);

  // A cell still running when the block goes away is stopped.
  useEffect(() => () => running?.stop(), [running]);

  const run = async () => {
    if (running) return;
    const { runCode } = await import('./sandbox/run');
    const pieces: Piece[] = [];
    setOutput([]);
    setTruncated(false);
    setStatus(t('codeCells.status.starting', { language: t(`codeCells.languages.${language}`) }));
    const handle = runCode(
      language,
      text,
      (stream, chunk) => {
        const last = pieces.at(-1);
        if (last?.stream === stream) last.text += chunk;
        else pieces.push({ stream, text: chunk });
        setOutput([...pieces]);
      },
      LIMITS,
      () => setStatus(t('codeCells.status.running')),
    );
    setRunning(handle);
    const result = await handle.done;
    setRunning(null);
    setTruncated(result.truncated);
    const said = statusText(result);
    setStatus(said);
    announce(said);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      void run();
      return;
    }
    if (event.key === 'Escape') {
      escaped.current = true;
      if (running) {
        event.stopPropagation();
        running.stop();
      }
      return;
    }
    if (event.key === 'Tab' && !readOnly && !escaped.current && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const area = event.currentTarget;
      const next = indentAt(
        text,
        area.selectionStart,
        area.selectionEnd,
        event.shiftKey,
        language === 'python' ? 4 : 2,
      );
      setText(next.text);
      requestAnimationFrame(() => area.setSelectionRange(next.start, next.end));
      return;
    }
    escaped.current = false;
  };

  const lines = Math.min(24, Math.max(4, text.split('\n').length + 1));
  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <label className={styles.field}>
          {t('codeCells.language')}
          <select
            value={language}
            disabled={readOnly || running !== null}
            onChange={(event) => {
              const next = event.target.value as CodeLanguage;
              // The other language's example becomes this one's; the person's own code stays as it is.
              const swapped = text === t(`codeCells.starter.${language}`) ? t(`codeCells.starter.${next}`) : text;
              sent.current = swapped;
              setText(swapped);
              onChange({ language: next, source: swapped });
            }}
          >
            {LANGUAGES.map((one) => (
              <option key={one} value={one}>
                {t(`codeCells.languages.${one}`)}
              </option>
            ))}
          </select>
        </label>
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
          }}
        >
          {t('codeCells.clear')}
        </Button>
      </div>
      <label className={styles.field}>
        {t('codeCells.code')}
        <textarea
          className={styles.source}
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={lines}
          aria-describedby={helpId}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <p className={styles.help}>
        <span id={helpId}>{t('codeCells.codeHelp')}</span>{' '}
        {t('codeCells.safety', { seconds: SECONDS, megabytes: MEGABYTES })}
      </p>
      <p className={styles.status} role="status">
        {status}
      </p>
      {output.length > 0 || (status !== '' && !running) ? (
        <pre className={styles.output} role="log" aria-live="off" aria-label={t('codeCells.output')} tabIndex={0}>
          {output.length === 0
            ? t('codeCells.noOutput')
            : output.map((piece, index) => (
                <span key={index} className={piece.stream === 'err' ? styles.err : undefined}>
                  {piece.text}
                </span>
              ))}
          {truncated ? <span className={styles.err}>{`\n${t('codeCells.status.truncated')}`}</span> : null}
        </pre>
      ) : null}
    </div>
  );
}
