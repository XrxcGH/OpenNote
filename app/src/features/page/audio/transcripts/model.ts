// A recording's transcript as the page keeps it (Phase 12 and the audio lane). It sits in a block of type
// `ext:org.opennote/transcript` next to the recording, whose `data` is a `TranscriptData`. Every time is a position in
// the recording's audio, in milliseconds, so a click on a line is a seek. The block's fallback text is the transcript
// as plain text, which is what search indexes and what a reader that doesn't know the block shows.
//
// Everything here is plain functions on plain data, so each change is a new value and nothing is edited in place.

import { momentHref } from './moment';

export { momentHref, parseMomentHref, TRANSCRIPT_TYPE } from './moment';

export interface Line {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Speaker 1, 2, and so on. Absent when nobody knows who spoke. */
  speaker?: number;
}

export interface Chapter {
  startMs: number;
  endMs: number;
  title: string;
}

export interface TranscriptData {
  recording: string;
  language: string | null;
  /** One paragraph. Empty until summaries are on and the person asks. */
  summary: string;
  lines: Line[];
  /** The names the person gave speakers, by speaker number. Others read "Speaker 3". */
  speakers: Record<string, string>;
  chapters: Chapter[];
  /** Where the lines came from: a speech engine, a caption or text file, or what the person typed. */
  source: 'engine' | 'imported' | 'typed';
}

/** What a speech engine reports for a stretch of speech. */
export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: number;
}

/** The word before a speaker's number, in the language of the interface. It is passed in so this file needs none. */
export type SpeakerWord = (n: number) => string;

export function clockMs(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** The name shown for a speaker: the one the person gave, or the numbered default. */
export const speakerName = (data: TranscriptData, n: number, fallback: SpeakerWord): string =>
  data.speakers[String(n)]?.trim() || fallback(n);

/** The speaker numbers that appear, in order. */
export function speakersOf(data: TranscriptData): number[] {
  return [...new Set(data.lines.flatMap((line) => (line.speaker === undefined ? [] : [line.speaker])))].sort(
    (a, b) => a - b,
  );
}

/** The transcript as plain text, one line each: the time, the speaker, and the words. */
export function markdownOf(data: TranscriptData, fallback: SpeakerWord): string {
  const parts: string[] = [];
  if (data.summary.trim()) parts.push(data.summary.trim());
  for (const line of data.lines) {
    const who = line.speaker === undefined ? '' : `${speakerName(data, line.speaker, fallback)}: `;
    parts.push(`[${clockMs(line.startMs)}] ${who}${line.text}`);
  }
  return parts.join('\n\n');
}

const replaceLine = (data: TranscriptData, id: string, change: (line: Line) => Line): TranscriptData => ({
  ...data,
  lines: data.lines.map((line) => (line.id === id ? change(line) : line)),
});

export const setLineText = (data: TranscriptData, id: string, text: string): TranscriptData =>
  replaceLine(data, id, (line) => ({ ...line, text }));

/** The most words on either side of a fix that is still offered as one vocabulary term. */
const MAX_FIX_WORDS = 4;

/**
 * The words the person changed when fixing a line: what the line said and what it says now, without the words both
 * share at the start and the end. Null when nothing changed, when only words were added or removed, or when the change
 * is too long to be one term (a rewrite, not a fix).
 */
export function fixedWords(before: string, after: string): { original: string; fixed: string } | null {
  const strip = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const a = before.trim().split(/\s+/).filter(Boolean);
  const b = after.trim().split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  const original = a
    .slice(start, a.length - end)
    .map(strip)
    .filter(Boolean)
    .join(' ');
  const fixed = b
    .slice(start, b.length - end)
    .map(strip)
    .filter(Boolean)
    .join(' ');
  if (!original || !fixed || original === fixed) return null;
  const count = (text: string) => text.split(' ').length;
  if (count(original) > MAX_FIX_WORDS || count(fixed) > MAX_FIX_WORDS) return null;
  return { original, fixed };
}

/** Gives a line to a speaker, or to nobody with undefined. */
export function setLineSpeaker(data: TranscriptData, id: string, speaker: number | undefined): TranscriptData {
  return replaceLine(data, id, (line) => {
    const { speaker: _old, ...rest } = line;
    return speaker === undefined ? rest : { ...rest, speaker };
  });
}

/** Names a speaker once for the whole transcript. An empty name goes back to "Speaker N". */
export function renameSpeaker(data: TranscriptData, n: number, name: string): TranscriptData {
  const { [String(n)]: _old, ...others } = data.speakers;
  const clean = name.trim();
  return { ...data, speakers: clean ? { ...others, [String(n)]: clean } : others };
}

/** The lowest speaker number that no line uses. */
export const nextSpeaker = (data: TranscriptData): number => Math.max(0, ...speakersOf(data)) + 1;

/**
 * Takes out what was said in a part of the audio that was removed, and moves what came later earlier by the length of
 * the part, as the audio moved. A line that overlaps the part goes whole, because its words cannot be cut cleanly.
 * The summary and chapters are made from the whole, so they may carry what was removed; they go too.
 */
export function removeRange(data: TranscriptData, startMs: number, endMs: number): TranscriptData {
  const length = endMs - startMs;
  const kept = data.lines.filter((line) => line.endMs <= startMs || line.startMs >= endMs);
  const shift = (ms: number) => (ms >= endMs ? ms - length : ms);
  return {
    ...data,
    summary: kept.length === data.lines.length ? data.summary : '',
    lines: kept.map((line) => ({ ...line, startMs: shift(line.startMs), endMs: shift(line.endMs) })),
    chapters:
      kept.length === data.lines.length
        ? data.chapters.map((c) => ({ ...c, startMs: shift(c.startMs), endMs: shift(c.endMs) }))
        : [],
  };
}

/** Moves every line by a number of milliseconds, never before the start. */
export function shiftBy(data: TranscriptData, deltaMs: number): TranscriptData {
  const move = (ms: number) => Math.max(0, Math.round(ms + deltaMs));
  return {
    ...data,
    lines: data.lines.map((line) => ({ ...line, startMs: move(line.startMs), endMs: move(line.endMs) })),
    chapters: data.chapters.map((chapter) => ({
      ...chapter,
      startMs: move(chapter.startMs),
      endMs: move(chapter.endMs),
    })),
  };
}

/** The lines before and after a split position. The second half's times start again from zero. */
export function splitAt(data: TranscriptData, atMs: number): [TranscriptData, TranscriptData] {
  const first = data.lines.filter((line) => line.startMs < atMs);
  const second = data.lines
    .filter((line) => line.startMs >= atMs)
    .map((line) => ({ ...line, startMs: line.startMs - atMs, endMs: line.endMs - atMs }));
  return [
    { ...data, summary: '', lines: first, chapters: [] },
    { ...data, summary: '', lines: second, chapters: [] },
  ];
}

let counter = 0;
const lineId = (): string => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A transcript from what a speech engine or a caption file reported. */
export function fromSegments(
  recording: string,
  segments: readonly Segment[],
  source: TranscriptData['source'],
  language: string | null = null,
): TranscriptData {
  return {
    recording,
    language,
    summary: '',
    lines: segments
      .filter((segment) => segment.text.trim() !== '')
      .map((segment) => ({
        id: lineId(),
        startMs: Math.max(0, Math.round(segment.startMs)),
        endMs: Math.max(0, Math.round(segment.endMs)),
        text: segment.text.trim(),
        ...(segment.speaker === undefined ? {} : { speaker: segment.speaker }),
      })),
    speakers: {},
    chapters: [],
    source,
  };
}

/** "00:01:02,500" or "1:02.5" or "62" as milliseconds, or null. */
export function parseStamp(text: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$|^(\d+)(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  if (match[5] !== undefined) return Number(match[5]) * 1000 + fraction(match[6]);
  const [h, m, s] = [Number(match[1] ?? 0), Number(match[2]), Number(match[3])];
  return ((h * 60 + m) * 60 + s) * 1000 + fraction(match[4]);
}

const fraction = (digits: string | undefined): number => (digits ? Number(digits.padEnd(3, '0')) : 0);

const CUE = /^(\S+)\s+-->\s+(\S+)/;
const LEADING_STAMP = /^\[?((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*[-–:]?\s+(.*)$/;

/**
 * Reads a transcript from text: SRT or WebVTT captions, lines that start with a time such as `[12:05] words`, or plain
 * paragraphs. Plain paragraphs have no times, so they are spread over `durationMs` by their length.
 */
export function parseTranscript(text: string, durationMs: number): { segments: Segment[]; timed: boolean } {
  const rows = text
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split('\n');
  const cues: Segment[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const cue = CUE.exec(rows[i].trim());
    const [start, end] = cue ? [parseStamp(cue[1]), parseStamp(cue[2])] : [null, null];
    if (start === null || end === null) continue;
    const words: string[] = [];
    while (i + 1 < rows.length && rows[i + 1].trim() !== '') words.push(rows[(i += 1)].trim());
    cues.push({ startMs: start, endMs: end, text: words.join(' ').replace(/<[^>]+>/g, '') });
  }
  if (cues.length > 0) return { segments: cues, timed: true };
  const stamped: Segment[] = [];
  for (const row of rows) {
    const found = LEADING_STAMP.exec(row.trim());
    const start = found ? parseStamp(found[1]) : null;
    if (found && start !== null) stamped.push({ startMs: start, endMs: start, text: found[2] });
    else if (stamped.length > 0 && row.trim() !== '') stamped[stamped.length - 1].text += ` ${row.trim()}`;
  }
  if (stamped.length > 0) {
    stamped.forEach(
      (segment, index) => (segment.endMs = stamped[index + 1]?.startMs ?? Math.max(segment.startMs, durationMs)),
    );
    return { segments: stamped, timed: true };
  }
  const paragraphs = text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0) || 1;
  let at = 0;
  const spread = paragraphs.map((paragraph) => {
    const length = (paragraph.length / total) * durationMs;
    const segment = { startMs: Math.round(at), endMs: Math.round(at + length), text: paragraph };
    at += length;
    return segment;
  });
  return { segments: spread, timed: false };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface QuoteOptions {
  includeSpeaker: boolean;
  fallback: SpeakerWord;
}

/** A piece of the editor's document, in the form the editor takes for inserting content. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** A time that links to its moment in the recording, followed by words. */
const timedParagraph = (recording: string, ms: number, words: string): DocNode => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: clockMs(ms), marks: [{ type: 'link', attrs: { href: momentHref(recording, ms) } }] },
    { type: 'text', text: ` ${words}` },
  ],
});

/** Selected lines as a quote for the notes: each line's time links to its moment, with the speaker if asked. */
export function quoteContent(data: TranscriptData, ids: ReadonlySet<string>, options: QuoteOptions): DocNode | null {
  const rows = data.lines
    .filter((line) => ids.has(line.id))
    .map((line) => {
      const who =
        options.includeSpeaker && line.speaker !== undefined
          ? `${speakerName(data, line.speaker, options.fallback)}: `
          : '';
      return timedParagraph(data.recording, line.startMs, `${who}${line.text}`);
    });
  return rows.length > 0 ? { type: 'blockquote', content: rows } : null;
}

/** An unchecked checkbox for the notes, with a link to the moment the task was spoken. */
export function taskContent(recording: string, ms: number, words: string): DocNode {
  return {
    type: 'bulletList',
    content: [{ type: 'listItem', attrs: { checked: false }, content: [timedParagraph(recording, ms, words)] }],
  };
}

/** The same quote as Markdown, for the clipboard when no note has the caret. */
export function quoteMarkdown(data: TranscriptData, ids: ReadonlySet<string>, options: QuoteOptions): string {
  return data.lines
    .filter((line) => ids.has(line.id))
    .map((line) => {
      const who =
        options.includeSpeaker && line.speaker !== undefined
          ? `${speakerName(data, line.speaker, options.fallback)}: `
          : '';
      return `> [${clockMs(line.startMs)}](${momentHref(data.recording, line.startMs)}) ${who}${line.text}`;
    })
    .join('\n>\n');
}

/** What the engine-free parts of intelligence take: the lines as the crate's transcript. */
export function forIntel(data: TranscriptData) {
  return {
    language: data.language,
    device: 'cpu' as const,
    segments: data.lines.map((line) => ({ startMs: line.startMs, endMs: line.endMs, text: line.text })),
  };
}

/** The text of the whole transcript, one paragraph, for a summary. */
export const plainText = (data: TranscriptData): string => data.lines.map((line) => line.text).join(' ');

export interface Recap {
  summary: string;
  decisions: readonly string[];
  actions: readonly { text: string; owner: string | null; due: string | null }[];
  /** The page's own headings, for a page with no transcript or no on-device intelligence. */
  headings: readonly string[];
}

export interface RecapParts {
  summary: boolean;
  decisions: boolean;
  actions: boolean;
  headings: boolean;
}

export interface RecapWords {
  summary: string;
  decisions: string;
  actions: string;
  headings: string;
}

/** The headings and the open checkboxes of a page's text, which stand in for a recap without intelligence. */
export function outlineOf(markdowns: readonly string[]): { headings: string[]; tasks: string[] } {
  const out = { headings: [] as string[], tasks: [] as string[] };
  for (const row of markdowns.flatMap((markdown) => markdown.split('\n'))) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(row);
    const task = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.+)$/.exec(row);
    if (heading) out.headings.push(heading[1]);
    else if (task) out.tasks.push(task[1].trim());
  }
  return out;
}

/** The recap as Markdown: a heading for each part chosen, and a list. */
export function recapMarkdown(recap: Recap, parts: RecapParts, words: RecapWords): string {
  const out: string[] = [];
  if (parts.headings && recap.headings.length > 0) {
    out.push(`## ${words.headings}\n\n${recap.headings.map((text) => `- ${text}`).join('\n')}`);
  }
  if (parts.summary && recap.summary) out.push(`## ${words.summary}\n\n${recap.summary}`);
  if (parts.decisions && recap.decisions.length > 0) {
    out.push(`## ${words.decisions}\n\n${recap.decisions.map((text) => `- ${text}`).join('\n')}`);
  }
  if (parts.actions && recap.actions.length > 0) {
    out.push(`## ${words.actions}\n\n${recap.actions.map((one) => `- [ ] ${actionText(one)}`).join('\n')}`);
  }
  return out.join('\n\n');
}

/** The recap as HTML, which pastes as formatted text into mail and chat. */
export function recapHtml(recap: Recap, parts: RecapParts, words: RecapWords): string {
  const out: string[] = [];
  if (parts.headings && recap.headings.length > 0) {
    const items = recap.headings.map((text) => `<li>${escapeHtml(text)}</li>`).join('');
    out.push(`<h2>${escapeHtml(words.headings)}</h2><ul>${items}</ul>`);
  }
  if (parts.summary && recap.summary) {
    out.push(`<h2>${escapeHtml(words.summary)}</h2><p>${escapeHtml(recap.summary)}</p>`);
  }
  if (parts.decisions && recap.decisions.length > 0) {
    const items = recap.decisions.map((text) => `<li>${escapeHtml(text)}</li>`).join('');
    out.push(`<h2>${escapeHtml(words.decisions)}</h2><ul>${items}</ul>`);
  }
  if (parts.actions && recap.actions.length > 0) {
    const items = recap.actions.map((one) => `<li>${escapeHtml(actionText(one))}</li>`).join('');
    out.push(`<h2>${escapeHtml(words.actions)}</h2><ul>${items}</ul>`);
  }
  return out.join('');
}

/** An action item as one line: the words, who, and when. */
export function actionText(one: { text: string; owner: string | null; due: string | null }): string {
  const tail = [one.owner, one.due].filter((part): part is string => Boolean(part));
  return tail.length > 0 ? `${one.text} (${tail.join(', ')})` : one.text;
}
