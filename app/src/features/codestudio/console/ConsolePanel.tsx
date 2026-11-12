// The console (DESIGN 5.1): standard output and standard error with their ANSI colors, file:line links that open
// the file at the line, the input line for a program that reads input, the input given at start, Clear, Copy
// output, and Insert into page.
//
// The log redraws from the console buffer alone. Each line redraws only when its text or the project's paths change.
// So typing in the editor and a growing log stay fast with thousands of lines.
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import type { StudioController } from '../window/controller';
import type { ConsoleLine, ConsoleSpan, LineKind } from './buffer';
import styles from './console.module.css';
import { findLinks } from './links';
import type { FileLink } from './links';

function spanClass(span: ConsoleSpan): string {
  return [
    span.err && span.fg === null ? styles.err : '',
    span.fg !== null ? styles[`fg${span.fg}`] : '',
    span.bold ? styles.bold : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A line's spans cut at its links' edges, so a link is one element over the colors inside it. */
function pieces(spans: readonly ConsoleSpan[], links: readonly FileLink[]) {
  const out: { span: ConsoleSpan; link: FileLink | null; key: number }[] = [];
  let offset = 0;
  let key = 0;
  for (const span of spans) {
    let start = 0;
    while (start < span.text.length) {
      const at = offset + start;
      const link = links.find((one) => at >= one.start && at < one.end) ?? null;
      const next = links.find((one) => one.start > at);
      const end = link ? link.end - offset : next ? next.start - offset : span.text.length;
      const cut = Math.min(span.text.length, end);
      out.push({ span: { ...span, text: span.text.slice(start, cut) }, link, key: key++ });
      start = cut;
    }
    offset += span.text.length;
  }
  return out;
}

interface LineProps {
  kind: LineKind;
  /** A new array whenever the line's text changes (buffer.ts), so it is what a redraw compares. */
  spans: readonly ConsoleSpan[];
  files: readonly string[];
  open: (link: FileLink) => void;
}

const Line = memo(function Line({ kind, spans, files, open }: LineProps) {
  const links = useMemo(
    () => (kind === 'output' ? findLinks(spans.map((span) => span.text).join(''), files) : []),
    [kind, spans, files],
  );
  const parts = pieces(spans, links);
  const rows: React.ReactNode[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (!part.link) {
      rows.push(
        <span key={part.key} className={spanClass(part.span)}>
          {part.span.text}
        </span>,
      );
      continue;
    }
    const link = part.link;
    const inside = [];
    while (index < parts.length && parts[index]!.link === link) inside.push(parts[index++]!);
    index -= 1;
    rows.push(
      <button
        key={part.key}
        type="button"
        className={styles.link}
        aria-label={t('codeStudio.studio.console.openAt', { file: link.file, line: link.line })}
        onClick={() => open(link)}
      >
        {inside.map((one) => (
          <span key={one.key} className={spanClass(one.span)}>
            {one.span.text}
          </span>
        ))}
      </button>,
    );
  }
  return (
    <div className={styles.line} data-kind={kind}>
      {rows}
    </div>
  );
});

/** The log: one Line per console line, redrawn only for the lines that changed. */
const Log = memo(function Log({
  lines,
  files,
  open,
}: {
  lines: readonly ConsoleLine[];
  files: readonly string[];
  open: (link: FileLink) => void;
}) {
  return lines.map((line) => <Line key={line.id} kind={line.kind} spans={line.spans} files={files} open={open} />);
});

function InputLine({ controller }: { controller: StudioController }) {
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  const waiting = controller.runState === 'waiting';
  useEffect(() => {
    if (waiting) field.current?.focus({ preventScroll: true });
  }, [waiting]);
  if (!controller.running) return null;
  return (
    <form
      className={styles.inputLine}
      onSubmit={(event) => {
        event.preventDefault();
        controller.sendInput(text);
        setText('');
      }}
    >
      <label htmlFor={id} className={styles.prompt}>
        {controller.inputPrompt || t('codeStudio.studio.console.inputLabel')}
      </label>
      <input
        id={id}
        ref={field}
        value={text}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setText(event.target.value)}
        aria-keyshortcuts="Control+D"
        aria-describedby={`${id}-help`}
        onKeyDown={(event) => {
          if (event.key === 'd' && event.ctrlKey) {
            event.preventDefault();
            controller.endInput();
          }
        }}
      />
      <span id={`${id}-help`} className={styles.visuallyHidden}>
        {t('codeStudio.studio.console.endInputHelp')}
      </span>
      {/* End of input as a button too, for touch and pen, where there is no Ctrl+D. */}
      <Button variant="quiet" type="button" onClick={() => controller.endInput()}>
        {t('codeStudio.studio.console.endInput')}
      </Button>
    </form>
  );
}

function StdinBox({ controller }: { controller: StudioController }) {
  const project = controller.project()!;
  const [text, setText] = useState(project.stdin);
  const id = useId();
  return (
    <div className={styles.stdin}>
      <label htmlFor={id}>{t('codeStudio.studio.console.stdinLabel')}</label>
      <textarea
        id={id}
        value={text}
        rows={3}
        spellCheck={false}
        readOnly={!(controller.store?.editable ?? false)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== project.stdin) controller.setStdin(text);
        }}
      />
      <p className={styles.help}>{t('codeStudio.studio.console.stdinHelp')}</p>
    </div>
  );
}

export function ConsolePanel({ controller }: { controller: StudioController }) {
  const [showStdin, setShowStdin] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const buffer = controller.console;
  const lines = useSyncExternalStore(
    (listener) => buffer.subscribe(listener),
    () => buffer.lines,
  );
  // The paths as one string, so the lines' links redraw only when a file is added, renamed, or deleted.
  const paths = Object.values(controller.project()?.files ?? {})
    .map((file) => file.path)
    .join('\n');
  const files = useMemo(() => (paths ? paths.split('\n') : []), [paths]);
  const open = useMemo(() => (link: FileLink) => controller.openPath(link.file, link.line, link.column), [controller]);
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);
  return (
    <div className={styles.console}>
      <div className={styles.actions}>
        <Button variant="quiet" aria-pressed={showStdin} onClick={() => setShowStdin(!showStdin)}>
          {t('codeStudio.studio.console.stdin')}
        </Button>
        <Button variant="quiet" onClick={() => controller.console.clear()}>
          {t('codeStudio.studio.console.clear')}
        </Button>
        <Button variant="quiet" onClick={() => void controller.copyOutput()}>
          {t('codeStudio.studio.console.copy')}
        </Button>
        <Button variant="quiet" onClick={() => controller.insertOutput()}>
          {t('codeStudio.studio.console.insert')}
        </Button>
      </div>
      {showStdin && <StdinBox key={controller.project()!.stdin} controller={controller} />}
      <div ref={log} className={styles.output} role="log" aria-label={t('codeStudio.studio.console.output')}>
        <Log lines={lines} files={files} open={open} />
      </div>
      <InputLine controller={controller} />
    </div>
  );
}
