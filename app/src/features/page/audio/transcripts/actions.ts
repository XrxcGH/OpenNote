// What the transcript features do. The screens call these, and so do the commands; this module loads on first use.
// Making a transcript, summarizing it, finding action items, and chapters, quoting lines into the notes, the recap,
// and what a split or a removed part of the audio does to the words.
import { extrasOf, playable } from '../../../../core/audio';
import type { RecordingEntry } from '../../../../core/audio';
import type { ActionItem, Chapter as IntelChapter } from '../../../../services/intel';
import type { BlockJson } from '../../../../services/pages/types';
import { t } from '../../../../strings/t';
import { announce, showToast } from '../../../../ui';
import { dataOf as recordingData, recordingBlocks } from '../blocks';
import { describeError, platformAudio } from '../controller';
import { openFor, playAt } from '../playback';
import { targetEditor } from '../../formattingBar/target';
import { shownPage } from '../../history/shown';
import { shownLayer } from '../../mount';
import { parseDue } from '../../../tools';
import { currentEngine } from './engine';
import {
  forIntel,
  fromSegments,
  outlineOf,
  parseTranscript,
  plainText,
  quoteContent,
  quoteMarkdown,
  recapHtml,
  recapMarkdown,
  removeRange,
  shiftBy,
  splitAt,
  taskContent,
  momentHref,
  clockMs,
} from './model';
import type { Chapter, DocNode, Recap, TranscriptData } from './model';
import { addTranscript, dataOf, saveTranscript, speakerWord, transcriptBlocks, transcriptOf } from './store';

const WORKING = 'transcript-working';
const MAX_SUMMARY_CHARS = 1_000_000;

/** The block that holds a recording on the shown page. */
export const recordingHolder = (recording: string): BlockJson | null =>
  recordingBlocks().find((block) => recordingData(block)?.entry.id === recording) ?? null;

/** Plays the recording from a position in its audio. */
export async function playMs(recording: string, ms: number): Promise<void> {
  const holder = recordingHolder(recording);
  const page = shownPage.get()?.id;
  if (!holder || !page) return void showToast({ message: t('audioMore.transcript.momentGone') });
  if (await openFor(holder, page)) await playAt(ms * 1e6);
}

// ---- Making a transcript ----

/** Puts a transcript on the page after its recording, or in the place of the one it already has. */
async function place(holder: BlockJson, data: TranscriptData): Promise<void> {
  const existing = transcriptOf(data.recording);
  const previous = existing && dataOf(existing);
  if (existing && previous) await saveTranscript(existing.id, previous, data);
  else await addTranscript(data, holder.id);
}

/** Makes the transcript of a recording with the speech engine, from the original sound or the enhanced copy. */
export async function makeTranscript(holder: BlockJson, entry: RecordingEntry): Promise<boolean> {
  const engine = currentEngine();
  if (!engine) {
    showToast({
      message: t('audioMore.transcript.engineNone'),
      action: { label: t('audioMore.menu.importTranscript'), run: () => void addFromText(holder, entry) },
    });
    return false;
  }
  showToast({ id: WORKING, message: t('audioMore.transcript.engineWorking') });
  try {
    const page = shownPage.get()?.id ?? '';
    const which = extrasOf(entry).transcribeWith === 'enhanced' ? 'enhanced' : 'original';
    const result = await engine.transcribe({
      assetsDir: await platformAudio().assetsDir(page),
      entry: playable(entry, which),
    });
    const data = fromSegments(entry.id, result.segments, 'engine', result.language);
    const summary = await quietSummary(data);
    await place(holder, summary ? { ...data, summary } : data);
    showToast({ id: WORKING, message: t('audioMore.transcript.engineDone') });
    return true;
  } catch (error) {
    showToast({
      id: WORKING,
      message: t('audioMore.transcript.engineFailed', { message: describeError(error) }),
      tone: 'danger',
    });
    return false;
  }
}

/** Reads text or captions the person gave, and puts them on the page as the recording's transcript. */
export async function transcriptFromText(holder: BlockJson, entry: RecordingEntry, text: string): Promise<boolean> {
  const durationMs = Math.max(0, entry.endedNs - entry.startedNs) / 1e6;
  const { segments, timed } = parseTranscript(text, durationMs);
  const data = fromSegments(entry.id, segments, 'imported');
  if (data.lines.length === 0) {
    showToast({ message: t('audioMore.transcript.addEmpty'), tone: 'danger' });
    return false;
  }
  try {
    await place(holder, data);
    const message = t('audioMore.transcript.added', { count: data.lines.length });
    announce(timed ? message : `${message} ${t('audioMore.transcript.addedSpread')}`);
    showToast({ message: timed ? message : `${message} ${t('audioMore.transcript.addedSpread')}` });
    return true;
  } catch (error) {
    showToast({ message: describeError(error), tone: 'danger' });
    return false;
  }
}

/** Asks for the text of a transcript in a dialog, then adds it. */
export async function addFromText(holder: BlockJson, entry: RecordingEntry): Promise<void> {
  const { askForTranscript } = await import('./dialogs');
  const text = await askForTranscript();
  if (text !== null) await transcriptFromText(holder, entry, text);
}

// ---- Intelligence: summary, action items, chapters ----

const loadApi = async () => (await import('../../../intel')).loadApi();

/** A summary of one paragraph, or null if summaries are off, the person said not now, or it failed. */
export async function summarizeTranscript(data: TranscriptData): Promise<string | null> {
  const api = await loadApi();
  if (!(await api.askToTurnOn('summaries'))) return null;
  try {
    const client = await api.intelClient();
    const summary = await client.summarize(plainText(data).slice(0, MAX_SUMMARY_CHARS), { maxSentences: 3 });
    return summary.sentences.map((sentence) => sentence.text).join(' ');
  } catch (error) {
    api.reportProblem(error, 'text');
    return null;
  }
}

/** The same without asking: nothing happens if summaries are not on. */
async function quietSummary(data: TranscriptData): Promise<string | null> {
  try {
    const api = await loadApi();
    await api.loadIntel();
    if (!api.isOn('summaries') || data.lines.length === 0) return null;
    const client = await api.intelClient();
    const summary = await client.summarize(plainText(data).slice(0, MAX_SUMMARY_CHARS), { maxSentences: 3 });
    return summary.sentences.map((sentence) => sentence.text).join(' ');
  } catch {
    return null;
  }
}

/** Finds tasks and decisions. Suggestions only: nothing is added to the page. */
export async function findActionItems(data: TranscriptData): Promise<ActionItem[] | null> {
  const api = await loadApi();
  if (!(await api.askToTurnOn('summaries'))) return null;
  try {
    return await (await api.intelClient()).actionItems(forIntel(data));
  } catch (error) {
    api.reportProblem(error, 'text');
    return null;
  }
}

/** Cuts the talk into titled chapters. Suggestions only. */
export async function findChapters(data: TranscriptData): Promise<Chapter[] | null> {
  const api = await loadApi();
  if (!(await api.askToTurnOn('summaries'))) return null;
  try {
    const found: IntelChapter[] = await (await api.intelClient()).chapters(forIntel(data), {});
    return found.map((chapter, index) => ({
      startMs: chapter.startMs,
      endMs: chapter.endMs,
      title: chapter.title.trim() || t('audioMore.transcript.chapterPart', { n: index + 1 }),
    }));
  } catch (error) {
    api.reportProblem(error, 'text');
    return null;
  }
}

/** The date a deadline phrase such as "by Friday" means, as 2026-10-09, or null if it is not a date. */
export function dueDate(phrase: string, now: number = Date.now()): string | null {
  const result = parseDue(phrase, { now, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (!result.ok) return null;
  const { year, month, day } = result.due.date;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${year}-${two(month)}-${two(day)}`;
}

/** The words of a checkbox for an action item: what, who, and by when. */
export function actionWords(item: ActionItem): string {
  const due = item.due ? dueDate(item.due) : null;
  const tail = [item.owner, item.due ? (due ? t('audioMore.transcript.due', { date: due }) : item.due) : null].filter(
    (part): part is string => Boolean(part),
  );
  return tail.length > 0 ? `${item.text} (${tail.join(', ')})` : item.text;
}

// ---- Into the notes ----

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Puts content at the caret of the notes. With no note to put it in, the text goes to the clipboard instead. */
async function intoNotes(node: DocNode, markdown: string): Promise<boolean> {
  const editor = targetEditor();
  if (editor?.chain().focus().insertContent(node).run()) return true;
  await copyText(markdown).catch(() => undefined);
  showToast({ message: t('audioMore.transcript.copied') });
  return false;
}

/** Adds an action item to the page as a checkbox with a link to its moment. */
export async function addActionToPage(data: TranscriptData, item: ActionItem): Promise<void> {
  const words = actionWords(item);
  const placed = await intoNotes(
    taskContent(data.recording, item.startMs, words),
    `- [ ] [${clockMs(item.startMs)}](${momentHref(data.recording, item.startMs)}) ${words}`,
  );
  if (placed) announce(t('audioMore.transcript.actionAdded'));
}

/** Copies the chosen lines into the notes as a quote with a link to each moment. */
export async function quoteLines(data: TranscriptData, ids: ReadonlySet<string>, includeSpeaker: boolean) {
  const options = { includeSpeaker, fallback: speakerWord };
  const node = quoteContent(data, ids, options);
  if (!node) return void showToast({ message: t('audioMore.transcript.nothingSelected') });
  const placed = await intoNotes(node, quoteMarkdown(data, ids, options));
  if (placed) announce(t('audioMore.transcript.inserted', { count: ids.size }));
}

// ---- The recap ----

/** What a recap can hold: the transcript's summary, decisions and tasks, and the page's own headings. */
export async function collectRecap(): Promise<Recap> {
  const markdowns = (shownLayer.get()?.blocks() ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => (typeof block.data['markdown'] === 'string' ? block.data['markdown'] : ''));
  const outline = outlineOf(markdowns);
  const transcripts = transcriptBlocks().flatMap((block) => dataOf(block) ?? []);
  let summary = transcripts.map((data) => data.summary).find(Boolean) ?? '';
  const decisions: string[] = [];
  const actions: Recap['actions'][number][] = [];
  try {
    const api = await loadApi();
    await api.loadIntel();
    if (transcripts.length > 0 && api.isOn('summaries')) {
      const client = await api.intelClient();
      for (const data of transcripts) {
        if (!summary && data.lines.length > 0) {
          const made = await client.summarize(plainText(data).slice(0, MAX_SUMMARY_CHARS), { maxSentences: 3 });
          summary = made.sentences.map((sentence) => sentence.text).join(' ');
        }
        for (const item of await client.actionItems(forIntel(data))) {
          if (item.kind === 'decision') decisions.push(item.text);
          else actions.push({ text: item.text, owner: item.owner, due: item.due });
        }
      }
    }
  } catch {
    // Without intelligence the recap is the page's own headings and checkboxes.
  }
  const tasks = actions.length > 0 ? actions : outline.tasks.map((text) => ({ text, owner: null, due: null }));
  return { summary, decisions, actions: tasks, headings: outline.headings };
}

/** Puts a recap on the clipboard as formatted text, which pastes into mail and chat, or as Markdown. */
export async function copyRecapText(
  recap: Recap,
  parts: Parameters<typeof recapMarkdown>[1],
  format: 'formatted' | 'markdown',
) {
  const words = {
    summary: t('audioMore.transcript.recapSummary'),
    decisions: t('audioMore.transcript.recapDecisions'),
    actions: t('audioMore.transcript.recapActions'),
    headings: t('audioMore.transcript.heading'),
  };
  const markdown = recapMarkdown(recap, parts, words);
  if (format === 'formatted' && typeof ClipboardItem !== 'undefined') {
    const html = recapHtml(recap, parts, words);
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      }),
    ]);
  } else {
    await copyText(markdown);
  }
  showToast({ message: t('audioMore.transcript.recapCopied') });
}

// ---- When the audio changes ----

/** The audio between two positions was removed: its words leave the transcript, and the later ones move earlier. */
export async function afterRemoval(recording: string, startNs: number, endNs: number): Promise<void> {
  const block = transcriptOf(recording);
  const data = block && dataOf(block);
  if (block && data) await saveTranscript(block.id, data, removeRange(data, startNs / 1e6, endNs / 1e6));
}

/** Silence was trimmed from the start of the audio, so what was said starts earlier by that much. */
export async function afterTrim(recording: string, headNs: number): Promise<void> {
  const block = transcriptOf(recording);
  const data = block && dataOf(block);
  if (block && data) await saveTranscript(block.id, data, shiftBy(data, -headNs / 1e6));
}

/** The recording was split: each half keeps its words, and the second half's go to a transcript of its own. */
export async function afterSplit(
  recording: string,
  secondRecording: string,
  atNs: number,
  secondBlock: string,
): Promise<void> {
  const block = transcriptOf(recording);
  const data = block && dataOf(block);
  if (!block || !data) return;
  const [first, second] = splitAt(data, atNs / 1e6);
  await saveTranscript(block.id, data, first);
  if (second.lines.length > 0) await addTranscript({ ...second, recording: secondRecording }, secondBlock);
}
