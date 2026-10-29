// The translation seam (A3-25). An engine turns lines of text from one language into another on this device, using a
// language pack the person downloaded. Nothing here translates by itself: a build ships an engine, and until one is
// installed the feature says so and offers nothing it cannot do. Translating never leaves the device.
import { assemble, plan } from './segment';

export interface LanguagePack {
  /** A stable name, such as `en-es`. */
  id: string;
  /** BCP 47 primary tags of the languages it reads and writes. */
  from: string;
  to: string;
  /** Names for the interface, in the interface's language. */
  name: string;
  /** What the download costs, in bytes. */
  size: number;
}

export interface TranslationEngine {
  readonly name: string;
  /** The packs this engine can use, including ones not yet on this device. */
  packs(): Promise<readonly LanguagePack[]>;
  /** The ids of the packs that are on this device. */
  installed(): Promise<ReadonlySet<string>>;
  /** Downloads a pack. Only called after the person agreed to its size. Resolves when it is ready to use. */
  install(pack: LanguagePack, onProgress?: (fraction: number) => void): Promise<void>;
  remove(pack: LanguagePack): Promise<void>;
  /** Translates each line. The answer has one line for each one given, in order. */
  translate(lines: readonly string[], from: string | null, to: string): Promise<string[]>;
}

let engine: TranslationEngine | null = null;

/** Installs an engine. Returns the function that takes it out again. */
export function useTranslationEngine(next: TranslationEngine): () => void {
  engine = next;
  return () => {
    if (engine === next) engine = null;
  };
}

/** The engine this build has, or null when it has none. */
export function translationEngine(): TranslationEngine | null {
  return engine;
}

export interface Translated {
  text: string;
  /** Lines the engine spoiled, which keep their original words. */
  kept: number;
}

/** The most lines one request sends, so a long page is done in steps the person can stop. */
export const BATCH = 40;

/** Translates a Markdown document, keeping its formatting. `onProgress` gets 0 through 1. */
export async function translateMarkdown(
  markdown: string,
  using: TranslationEngine,
  from: string | null,
  to: string,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<Translated> {
  const planned = plan(markdown);
  const sources = planned.send.map((i) => planned.lines[i]?.text ?? '');
  const out: string[] = [];
  for (let at = 0; at < sources.length; at += BATCH) {
    if (options.signal?.aborted) throw new DOMException('Translation stopped.', 'AbortError');
    const batch = sources.slice(at, at + BATCH);
    const answer = await using.translate(batch, from, to);
    // An engine that returns the wrong number of lines cannot be matched to the page, so none of it is used.
    if (answer.length !== batch.length) throw new Error('The translation engine returned the wrong number of lines.');
    out.push(...answer);
    options.onProgress?.(Math.min(1, (at + batch.length) / Math.max(1, sources.length)));
  }
  return assemble(markdown, planned, out);
}

const primary = (tag: string): string => tag.split('-')[0]?.toLowerCase() ?? tag;

/** The pack that translates from one language to another, or null. With no known source, any pack into `to` serves. */
export function packFor(packs: readonly LanguagePack[], from: string | null, to: string): LanguagePack | null {
  const [target, source] = [primary(to), from ? primary(from) : null];
  return packs.find((pack) => pack.to === target && (source === null || pack.from === source)) ?? null;
}

/** A size such as 62 MB, for the consent line. It counts as the models list does: a megabyte is a million bytes. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
