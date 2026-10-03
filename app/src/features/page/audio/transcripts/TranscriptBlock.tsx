// The transcript on the page: a one-paragraph summary, then each line with its time, and the speaker. A time plays
// the recording from that line. The line being spoken is marked while the recording plays. The words can be edited,
// speakers renamed once for the whole transcript, lines copied into the notes, and action items and chapters
// suggested (nothing is added until it is chosen).
import { useId, useState } from 'react';
import { useFlag } from '../../../../app/flags';
import type { BlockJson } from '../../../../services/pages/types';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { Button, showToast, Switch } from '../../../../ui';
import { describeError } from '../controller';
import { playbackUi } from '../playback';
import {
  actionWords,
  addActionToPage,
  findActionItems,
  findChapters,
  type FoundAction,
  playMs,
  quoteLines,
  summarizeTranscript,
} from './actions';
import { clockMs, nextSpeaker, renameSpeaker, setLineSpeaker, setLineText, speakerName, speakersOf } from './model';
import type { Chapter, Line, TranscriptData } from './model';
import { dataOf, lineSelection, rememberSpeakerName, saveTranscript, speakerWord } from './store';
import styles from './transcripts.module.css';

type Save = (next: TranscriptData) => Promise<void>;

const EMPTY: ReadonlySet<string> = new Set();

function LineRow(props: {
  data: TranscriptData;
  line: Line;
  editing: boolean;
  speakers: boolean;
  selectable: boolean;
  selected: boolean;
  active: boolean;
  onSelect(on: boolean): void;
  save: Save;
}) {
  const { data, line, editing, speakers, selectable, selected, active } = props;
  const time = clockMs(line.startMs);
  const who = line.speaker === undefined ? null : speakerName(data, line.speaker, speakerWord);
  return (
    <li className={styles.line} aria-current={active ? 'true' : undefined} data-active={active ? 'true' : undefined}>
      {selectable && (
        <input
          type="checkbox"
          aria-label={t('audioMore.transcript.selectLine', { time })}
          checked={selected}
          onChange={(event) => props.onSelect(event.target.checked)}
        />
      )}
      <Button
        variant="quiet"
        className={styles.time}
        aria-label={t('audioMore.transcript.play', { time })}
        onClick={() => void playMs(data.recording, line.startMs)}
      >
        {time}
      </Button>
      <div className={styles.words}>
        {speakers && !editing && who && <strong className={styles.speaker}>{who}</strong>}
        {speakers && editing && (
          <select
            className={styles.select}
            aria-label={t('audioMore.transcript.lineSpeaker', { time })}
            value={line.speaker ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              const speaker = value === '' ? undefined : value === 'new' ? nextSpeaker(data) : Number(value);
              void props.save(setLineSpeaker(data, line.id, speaker));
            }}
          >
            <option value="">{t('audioMore.transcript.nobody')}</option>
            {speakersOf(data).map((n) => (
              <option key={n} value={n}>
                {speakerName(data, n, speakerWord)}
              </option>
            ))}
            <option value="new">{t('audioMore.transcript.newSpeaker')}</option>
          </select>
        )}
        {editing ? (
          <textarea
            className={styles.edit}
            aria-label={t('audioMore.transcript.lineText', { time })}
            defaultValue={line.text}
            rows={Math.max(1, Math.ceil(line.text.length / 70))}
            onBlur={(event) => {
              if (event.target.value !== line.text) void props.save(setLineText(data, line.id, event.target.value));
            }}
          />
        ) : (
          <span>{line.text}</span>
        )}
      </div>
    </li>
  );
}

function Speakers({ data, save }: { data: TranscriptData; save: Save }) {
  const numbers = speakersOf(data);
  if (numbers.length === 0) return null;
  const rename = async (n: number) => {
    const { askSpeakerName } = await import('./dialogs');
    const label = speakerName(data, n, speakerWord);
    const name = await askSpeakerName(data.speakers[String(n)] ?? '', label);
    if (name === null) return;
    rememberSpeakerName(name);
    await save(renameSpeaker(data, n, name));
  };
  return (
    <ul className={styles.chips} aria-label={t('audioMore.transcript.speakers')}>
      {numbers.map((n) => {
        const name = speakerName(data, n, speakerWord);
        return (
          <li key={n}>
            <Button
              variant="secondary"
              aria-label={t('audioMore.transcript.rename', { name })}
              onClick={() => void rename(n)}
            >
              {name}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Suggestions(props: {
  data: TranscriptData;
  actions: FoundAction[] | null;
  chapters: Chapter[] | null;
  save: Save;
  clear(): void;
}) {
  const { data, actions, chapters } = props;
  return (
    <section className={styles.suggestions} aria-label={t('audioMore.transcript.suggestions')}>
      <p className={styles.help}>{t('audioMore.transcript.suggestionsHelp')}</p>
      {actions && (
        <>
          <h4>{t('audioMore.transcript.actionsHeading')}</h4>
          {actions.length === 0 && <p className={styles.help}>{t('audioMore.transcript.noActions')}</p>}
          <ul className={styles.rows}>
            {actions.map((item, index) => (
              <li key={`${item.startMs}-${index}`} className={styles.row}>
                <span className={styles.badge}>
                  {t(item.kind === 'decision' ? 'audioMore.transcript.decision' : 'audioMore.transcript.task')}
                </span>
                <span>{actionWords(item)}</span>
                <Button
                  variant="secondary"
                  aria-label={t('audioMore.transcript.addActionLabel', { text: item.text })}
                  onClick={() => void addActionToPage(data, item)}
                >
                  {t('audioMore.transcript.addAction')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {chapters && (
        <>
          <h4>{t('audioMore.transcript.chaptersHeading')}</h4>
          {chapters.length === 0 && <p className={styles.help}>{t('audioMore.transcript.noChapters')}</p>}
          {chapters.length > 0 && (
            <>
              <ChapterList chapters={chapters} recording={data.recording} />
              <Button
                variant="secondary"
                onClick={() => {
                  void props.save({ ...data, chapters }).then(() => {
                    showToast({ message: t('audioMore.transcript.chaptersKept') });
                    props.clear();
                  });
                }}
              >
                {t('audioMore.transcript.keepChapters')}
              </Button>
            </>
          )}
        </>
      )}
      <Button variant="quiet" onClick={props.clear}>
        {t('audioMore.transcript.dismiss')}
      </Button>
    </section>
  );
}

function ChapterList({ chapters, recording }: { chapters: readonly Chapter[]; recording: string }) {
  return (
    <ol className={styles.rows} aria-label={t('audioMore.transcript.chaptersHeading')}>
      {chapters.map((chapter, index) => (
        <li key={`${chapter.startMs}-${index}`} className={styles.row}>
          <Button
            variant="quiet"
            aria-label={t('audioMore.transcript.chapterGo', { title: chapter.title, time: clockMs(chapter.startMs) })}
            onClick={() => void playMs(recording, chapter.startMs)}
          >
            {clockMs(chapter.startMs)}
          </Button>
          <span>{chapter.title}</span>
        </li>
      ))}
    </ol>
  );
}

export function TranscriptView({ block }: { block: BlockJson }) {
  const data = dataOf(block);
  const position = useStore(playbackUi, (state) =>
    data && state.recording === data.recording ? (state.status?.positionNs ?? null) : null,
  );
  const [editing, setEditing] = useState(false);
  const picked = useStore(lineSelection, (state) => state);
  const selected: ReadonlySet<string> = picked.block === block.id ? picked.ids : EMPTY;
  const includeSpeaker = picked.includeSpeaker;
  const [suggested, setSuggested] = useState<{ actions: FoundAction[] | null; chapters: Chapter[] | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const speakersOn = useFlag('transcripts.speakers');
  const notesOn = useFlag('transcripts.notes');
  const actionsOn = useFlag('transcripts.actions');
  const recapOn = useFlag('transcripts.recap');
  const headingId = useId();
  if (!data) return <p className={styles.help}>{t('audioMore.transcript.noLines')}</p>;
  const save: Save = async (next) => {
    try {
      await saveTranscript(block.id, data, next);
    } catch (error) {
      showToast({ message: describeError(error), tone: 'danger' });
    }
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const nowMs = position === null ? null : position / 1e6;
  const activeId = nowMs === null ? null : data.lines.findLast((line) => line.startMs <= nowMs)?.id;
  return (
    <section className={styles.transcript} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h3 id={headingId}>{t('audioMore.transcript.heading')}</h3>
        <div className={styles.actions}>
          {actionsOn && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const found = await findActionItems(data);
                    if (found) setSuggested((held) => ({ actions: found, chapters: held?.chapters ?? null }));
                  })
                }
              >
                {t('audioMore.transcript.findActions')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const found = await findChapters(data);
                    if (found) setSuggested((held) => ({ actions: held?.actions ?? null, chapters: found }));
                  })
                }
              >
                {t('audioMore.transcript.makeChapters')}
              </Button>
            </>
          )}
          {recapOn && (
            <Button variant="secondary" onClick={() => void import('./dialogs').then((module) => module.openRecap())}>
              {t('audioMore.transcript.copyRecap')}
            </Button>
          )}
          <Button variant="secondary" aria-pressed={editing} onClick={() => setEditing(!editing)}>
            {t(editing ? 'audioMore.transcript.doneEditing' : 'audioMore.transcript.edit')}
          </Button>
        </div>
      </header>
      <div className={styles.summary}>
        <h4>{t('audioMore.transcript.summary')}</h4>
        <p>{data.summary || <span className={styles.help}>{t('audioMore.transcript.noSummary')}</span>}</p>
        {!data.summary && (
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const summary = await summarizeTranscript(data);
                if (summary) await save({ ...data, summary });
              })
            }
          >
            {t('audioMore.transcript.makeSummary')}
          </Button>
        )}
      </div>
      {speakersOn && <Speakers data={data} save={save} />}
      {data.chapters.length > 0 && (
        <div>
          <h4>{t('audioMore.transcript.chaptersHeading')}</h4>
          <ChapterList chapters={data.chapters} recording={data.recording} />
          <Button variant="quiet" onClick={() => void save({ ...data, chapters: [] })}>
            {t('audioMore.transcript.clearChapters')}
          </Button>
        </div>
      )}
      {suggested && (
        <Suggestions
          data={data}
          actions={suggested.actions}
          chapters={suggested.chapters}
          save={save}
          clear={() => setSuggested(null)}
        />
      )}
      <ol className={styles.lines}>
        {data.lines.map((line) => (
          <LineRow
            key={line.id}
            data={data}
            line={line}
            editing={editing}
            speakers={speakersOn}
            selectable={notesOn}
            selected={selected.has(line.id)}
            active={line.id === activeId}
            onSelect={(on) => {
              const next = new Set(selected);
              if (on) next.add(line.id);
              else next.delete(line.id);
              lineSelection.set((state) => ({ ...state, block: block.id, ids: next }));
            }}
            save={save}
          />
        ))}
      </ol>
      {data.lines.length === 0 && <p className={styles.help}>{t('audioMore.transcript.noLines')}</p>}
      {notesOn && (
        <footer className={styles.footer}>
          <span aria-live="polite">{t('audioMore.transcript.selected', { count: selected.size })}</span>
          {speakersOn && (
            <Switch
              label={t('audioMore.transcript.includeSpeaker')}
              checked={includeSpeaker}
              onChange={(on) => lineSelection.set((state) => ({ ...state, block: block.id, includeSpeaker: on }))}
            />
          )}
          <Button
            variant="secondary"
            onClick={() => void quoteLines(data, selected, speakersOn && includeSpeaker)}
            aria-keyshortcuts="Alt+Shift+O"
          >
            {t('audioMore.transcript.copyToNotes')}
          </Button>
        </footer>
      )}
    </section>
  );
}
