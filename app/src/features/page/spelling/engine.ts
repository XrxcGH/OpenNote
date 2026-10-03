// The page's spelling service (ARCHITECTURE.md section 16.3). Results are cached by text and languages, and checks
// are scheduled so typing never waits for them. Some words are hidden without checking again: the personal
// dictionary, words ignored this session, and words in all capitals or with digits.
import type { SpellingService } from '../../../editor/host';
import type { SpellRange } from '../../../editor/extensions/spellingRanges';
import type { SpellingClient } from '../../../platform/types';

export interface SpellingRules {
  enabled: boolean;
  languages: readonly string[];
  personalWords: readonly string[];
  ignoreUppercase: boolean;
  ignoreWithDigits: boolean;
}

export interface LanguageInfo {
  tag: string;
  name: string;
  isDefault: boolean;
}

export type ChangeKind = 'results' | 'rules';

export interface SpellingEngine extends SpellingService {
  /** Checks texts that have no results yet: 'now' for the textblocks in view, 'idle' for the rest. */
  check(texts: readonly string[], priority: 'now' | 'idle'): void;
  /** Called after results arrive, or after the rules change and every textblock needs reading again. */
  onChange(listener: (kind: ChangeKind) => void): () => void;
  suggest(word: string): Promise<string[]>;
  ignore(word: string): void;
  addWord(word: string): Promise<void>;
  removeWord(word: string): Promise<void>;
  /** The installed languages, once known. */
  languages(): Promise<LanguageInfo[]>;
  /** False when no enabled language has a spell checker, or spell check is off. */
  active(): boolean;
  setRules(rules: SpellingRules): void;
  destroy(): void;
}

export interface EngineTiming {
  /** After typing pauses this long, changed textblocks are checked. */
  typingDelayMs: number;
  idle(run: () => void): void;
}

export const CACHE_SIZE = 20_000;
export const MAX_ITEMS = 200;
export const MAX_CHARS = 128 * 1024;

const defaultIdle = (run: () => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1000 });
  else setTimeout(run, 16);
};

/** A least-recently-used map. */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly size: number) {}
  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value as string);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
}

/** The words a check never shows, decided without asking the checker again. */
class WordRules {
  private anyCase = new Set<string>();
  private exact = new Set<string>();
  readonly ignored = new Set<string>();
  rules: SpellingRules;

  constructor(rules: SpellingRules) {
    this.rules = rules;
    this.set(rules);
  }

  set(rules: SpellingRules): void {
    this.rules = rules;
    this.anyCase = new Set(rules.personalWords.filter((word) => word === word.toLowerCase()));
    this.exact = new Set(rules.personalWords.filter((word) => word !== word.toLowerCase()));
  }

  /** An all-lowercase personal word matches any capitalization; any other matches exactly. */
  skips(word: string): boolean {
    if (this.ignored.has(word) || this.exact.has(word) || this.anyCase.has(word.toLowerCase())) return true;
    const letters = word.replace(/[^\p{L}]/gu, '');
    const capitals = letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
    if (this.rules.ignoreUppercase && capitals) return true;
    return this.rules.ignoreWithDigits && /\p{N}/u.test(word);
  }
}

class Engine implements SpellingEngine {
  private readonly words: WordRules;
  private readonly cache = new Lru<readonly SpellRange[]>(CACHE_SIZE);
  private readonly listeners = new Set<(kind: ChangeKind) => void>();
  private readonly now = new Set<string>();
  private readonly idle = new Set<string>();
  private readonly typing = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private pumping = false;
  private destroyed = false;
  private installed: Promise<LanguageInfo[]> | null = null;
  private available = true;

  constructor(
    private readonly client: SpellingClient,
    initial: SpellingRules,
    private readonly timing: EngineTiming,
  ) {
    this.words = new WordRules(initial);
    void this.languages().then(() => !this.available && this.notify('rules'));
  }

  private get rules(): SpellingRules {
    return this.words.rules;
  }

  private languageKey(): string {
    return this.rules.languages.join(',');
  }

  private keyOf(text: string): string {
    return `${this.languageKey()}\u0001${text}`;
  }

  private notify(kind: ChangeKind): void {
    this.listeners.forEach((listener) => listener(kind));
  }

  active = (): boolean => this.rules.enabled && this.available && !this.destroyed;

  languages = async (): Promise<LanguageInfo[]> => {
    this.installed ??= this.client.languages().catch(() => []);
    const list = await this.installed;
    const wanted = this.rules.languages;
    const has = (tag: string) => list.some((language) => language.tag.toLowerCase() === tag.toLowerCase());
    this.available = wanted.length ? wanted.some(has) : list.some((language) => language.isDefault);
    return list;
  };

  /** Takes up to 200 waiting texts, at most 128 K characters, from `source`. */
  private takeBatch(source: Set<string>): string[] {
    const batch: string[] = [];
    let chars = 0;
    for (const text of source) {
      if (batch.length === MAX_ITEMS || chars + text.length > MAX_CHARS) break;
      source.delete(text);
      if (this.cache.has(this.keyOf(text)) || this.inFlight.has(text)) continue;
      batch.push(text);
      chars += text.length;
    }
    return batch;
  }

  private async send(batch: readonly string[]): Promise<void> {
    const key = this.languageKey();
    batch.forEach((text) => this.inFlight.add(text));
    try {
      const items = batch.map((text, index) => ({ id: String(index), text }));
      const results = await this.client.check(items, [...this.rules.languages]);
      for (const result of results) {
        const text = batch[Number(result.id)];
        if (text !== undefined) this.cache.set(`${key}\u0001${text}`, result.errors);
      }
    } catch {
      // A failed check leaves its texts unchecked; the next change asks again.
    } finally {
      batch.forEach((text) => this.inFlight.delete(text));
    }
  }

  /** Sends waiting texts, 'now' first, in requests of at most 200 items, one request at a time. */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.active() && (this.now.size || this.idle.size)) {
        // The rest waits for idle time, unless textblocks in view come in meanwhile.
        if (!this.now.size) await new Promise<void>((resolve) => this.timing.idle(resolve));
        const batch = this.takeBatch(this.now.size ? this.now : this.idle);
        if (!batch.length) continue;
        await this.send(batch);
        this.notify('results');
      }
    } finally {
      this.pumping = false;
    }
  }

  private queue(texts: Iterable<string>, into: Set<string>): void {
    for (const text of texts) {
      if (text.trim() && !this.cache.has(this.keyOf(text))) into.add(text);
    }
    void this.pump();
  }

  errorsFor = (text: string): readonly SpellRange[] | null => {
    if (!this.active() || !text.trim()) return [];
    const errors = this.cache.get(this.keyOf(text));
    if (!errors) return null;
    return errors.filter((error) => !this.words.skips(text.slice(error.start, error.start + error.length)));
  };

  requestCheck = (key: string, text: string): void => {
    if (!this.active()) return;
    this.typing.set(key, text);
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      const texts = [...this.typing.values()];
      this.typing.clear();
      this.queue(texts, this.now);
    }, this.timing.typingDelayMs);
  };

  check(texts: readonly string[], priority: 'now' | 'idle'): void {
    if (this.active()) this.queue(texts, priority === 'now' ? this.now : this.idle);
  }

  onChange(listener: (kind: ChangeKind) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async suggest(word: string): Promise<string[]> {
    if (!this.active()) return [];
    return this.client.suggest(word, this.rules.languages).catch(() => []);
  }

  ignore(word: string): void {
    this.words.ignored.add(word);
    this.notify('rules');
  }

  async addWord(word: string): Promise<void> {
    await this.client.addWord(word);
    const known = this.rules.personalWords;
    if (!known.includes(word)) this.words.set({ ...this.rules, personalWords: [...known, word] });
    this.notify('rules');
  }

  async removeWord(word: string): Promise<void> {
    await this.client.removeWord(word);
    this.words.set({ ...this.rules, personalWords: this.rules.personalWords.filter((known) => known !== word) });
    this.notify('rules');
  }

  setRules(next: SpellingRules): void {
    const languagesChanged = next.languages.join(',') !== this.languageKey();
    this.words.set(next);
    if (languagesChanged) void this.languages().then(() => this.notify('rules'));
    else this.notify('rules');
  }

  destroy(): void {
    this.destroyed = true;
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.listeners.clear();
  }
}

export function createSpellingEngine(
  client: SpellingClient,
  initial: SpellingRules,
  timing: EngineTiming = { typingDelayMs: 500, idle: defaultIdle },
): SpellingEngine {
  return new Engine(client, initial, timing);
}
