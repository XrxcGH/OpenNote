// A summary of a page (Phase 12): the sentences that best stand for it, and its keywords, picked from its own words.
// The page hands over its blocks as text, and each sentence is linked back to the block it came from. Nothing is
// written or sent: the crate chooses sentences and does not use a model.
import type { IntelClient, Keyword, Summary } from '../../services/intel';
import { showToast } from '../../ui';
import { t } from '../../strings/t';
import { askToTurnOn, intelClient, reportProblem } from './runtime';

/** A block's text, and how to bring the block into view. */
export interface PageText {
  text: string;
  reveal(): void;
}

/** The most text sent for one summary, in UTF-16 units. The crate's own limit is 4 MiB. */
export const MAX_SUMMARY_CHARS = 1_000_000;

export interface SummaryLine {
  text: string;
  /** Brings the sentence's block into view, or null when the block is unknown. */
  reveal: (() => void) | null;
}

export interface PageSummary {
  sentences: readonly SummaryLine[];
  keywords: readonly string[];
  /** How many sentences the page had. */
  total: number;
}

/** The blocks joined with line breaks, so each block ends a sentence, with the start of each in the joined text. */
export function joinBlocks(blocks: readonly PageText[]): { text: string; starts: number[] } {
  const starts: number[] = [];
  let text = '';
  for (const block of blocks) {
    if (text) text += '\n';
    starts.push(text.length);
    text += block.text;
  }
  return { text, starts };
}

/** The block a sentence starting at `at` belongs to. */
export function blockAt(starts: readonly number[], at: number): number {
  let found = 0;
  starts.forEach((start, index) => {
    if (start <= at) found = index;
  });
  return found;
}

export function toPageSummary(
  blocks: readonly PageText[],
  starts: readonly number[],
  summary: Summary,
  keywords: readonly Keyword[],
): PageSummary {
  return {
    sentences: summary.sentences.map((sentence) => ({
      text: sentence.text,
      reveal: blocks[blockAt(starts, sentence.span.start)]?.reveal ?? null,
    })),
    keywords: keywords.map((keyword) => keyword.text),
    total: summary.inputSentences,
  };
}

export interface SummarizeOptions {
  client?: () => Promise<IntelClient>;
  /** Asks the person to turn the feature on when it is off. */
  ensureOn?: () => Promise<boolean>;
  maxSentences?: number;
  maxKeywords?: number;
}

/** Summarizes the blocks. Null when the feature is off and the person said not now, or when the call failed. */
export async function summarizeBlocks(
  blocks: readonly PageText[],
  options: SummarizeOptions = {},
): Promise<PageSummary | null> {
  const { text, starts } = joinBlocks(blocks);
  // A page with no words has nothing to summarize, so it never asks the person to turn anything on.
  if (!text.trim()) return { sentences: [], keywords: [], total: 0 };
  const ensureOn = options.ensureOn ?? (() => askToTurnOn('summaries'));
  if (!(await ensureOn())) return null;
  const sent = text.slice(0, MAX_SUMMARY_CHARS);
  try {
    const client = await (options.client ?? intelClient)();
    const [summary, keywords] = await Promise.all([
      client.summarize(sent, { maxSentences: options.maxSentences ?? 5 }),
      client.keywords(sent, { maxKeywords: options.maxKeywords ?? 8 }),
    ]);
    return toPageSummary(blocks, starts, summary, keywords);
  } catch (error) {
    reportProblem(error, 'text');
    return null;
  }
}

/** Summarizes the blocks and shows the result in a dialog. */
export async function showPageSummary(blocks: readonly PageText[], options: SummarizeOptions = {}): Promise<void> {
  const summary = await summarizeBlocks(blocks, options);
  if (!summary) return;
  if (summary.sentences.length === 0) {
    showToast({ message: t('intel.summary.empty') });
    return;
  }
  const { openSummary } = await import('./SummaryDialog');
  openSummary(summary);
}
