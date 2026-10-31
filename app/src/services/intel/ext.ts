// The client for the shell's device store and model downloads (Phase 12). One command carries every method, so a new
// method needs no new permission. The store keeps small text files in this device's folder: the interface decides
// what goes in them. Nothing here reads a note.
import type { IntelTransport } from './transport';

/** A model's place in a download: not started, stopped partway, running, finished, or failed. */
export type ModelState = 'notInstalled' | 'partial' | 'downloading' | 'installed' | 'failed';

/** Why a download or call failed, in a word the interface turns into a sentence. */
export type ExtErrorCode =
  | 'offline'
  | 'safeMode'
  | 'network'
  | 'checksum'
  | 'stopping'
  | 'io'
  | 'invalid'
  | 'model'
  | 'unavailable'
  | 'engine'
  | 'unknown';

export interface ModelInfo {
  id: string;
  /** What the model is for, such as `speech`. */
  kind: string;
  name: string;
  detail: string;
  sizeBytes: number;
  state: ModelState;
  /** Bytes on disk, or downloaded so far. */
  bytes: number;
  error: ExtErrorCode | 'canceled' | null;
}

export interface ModelList {
  models: ModelInfo[];
  /** Seconds since 1970 when a download last started, or null. */
  lastRanUnix: number | null;
  /** Work offline is on, so no download can start. */
  offline: boolean;
}

/** One replacement a vocabulary made. The span counts UTF-16 units of the text that was given. */
export interface VocabularyChange {
  from: string;
  to: string;
  span: { start: number; end: number };
}

export interface VocabularyCorrection {
  text: string;
  changes: VocabularyChange[];
}

/** The features that can use the person's own cloud key instead of this device (A1-33). */
export type CloudFeature = 'transcription' | 'summaries' | 'tutor';

/** A feature's cloud key, as the interface may know it: whether there is one, never the key itself. */
export interface CloudStatus {
  feature: CloudFeature;
  provider: string;
  /** The one server the feature's input goes to with the key. */
  host: string;
  hasKey: boolean;
  /** Seconds since 1970 when the service was last used for this feature, or null. */
  lastUsedUnix: number | null;
}

/** What this build and install can run, for the screens that offer engines. */
export interface EngineInfo {
  /** whisper.cpp is built in, and runs speech much faster than the Rust reader. */
  whisperCpp: boolean;
  /** whisper.cpp can use the graphics card. */
  whisperGpu: boolean;
  /** ONNX Runtime is built in, for translation and the meaning model. */
  onnx: boolean;
  /** The language model program is in this install. */
  llmHost: boolean;
  /** A language model is downloaded. */
  languageModel: boolean;
}

export interface GenerateOptions {
  system: string;
  prompt: string;
  /** The most words of answer, as tokens. */
  maxTokens?: number;
  /** 0 keeps close to the text, and 1 allows more variety. */
  temperature?: number;
}

export interface IntelExt {
  /** The text kept under a name on this device, or null. */
  get(name: string): Promise<string | null>;
  put(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** The names kept on this device that start with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
  /** Fixes the words in `text` that the vocabulary lists, and reports each replacement. */
  correctVocabulary(vocabulary: string, text: string): Promise<VocabularyCorrection>;
  models: {
    list(): Promise<ModelList>;
    /** Starts a download, or resumes one that stopped. Rejects with `offline` while Work offline is on. */
    start(id: string): Promise<void>;
    /** Stops a download and keeps the part that arrived. */
    cancel(id: string): Promise<void>;
    /** Deletes the model and any part of it. */
    remove(id: string): Promise<void>;
  };
  engines: {
    info(): Promise<EngineInfo>;
  };
  /** The language model, for Ask and the writing tools. Rejects with `model` until one is downloaded. */
  llm: {
    generate(options: GenerateOptions): Promise<string>;
    /** Ends the program so its memory goes back to the computer. */
    stop(): Promise<void>;
  };
  /** Translation with a downloaded pack, such as `en-es`. Rejects with `model` until it is downloaded. */
  translate: {
    run(pack: string, lines: readonly string[]): Promise<string[]>;
  };
  /** Meaning vectors from the downloaded meaning model. */
  embed: {
    run(texts: readonly string[]): Promise<number[][]>;
  };
  cloud: {
    status(): Promise<CloudStatus[]>;
    /** Saves the key in Windows Credential Manager. Rejects with `invalid` for text that can't be a key. */
    setKey(feature: CloudFeature, key: string): Promise<void>;
    forget(feature: CloudFeature): Promise<void>;
    /** A summary from the service. Rejects with `offline` while Work offline is on. */
    summarize(text: string): Promise<string>;
    /** The tutor's reply to exactly this text (ADR 0050). Rejects with `offline` while Work offline is on. */
    tutor(system: string, prompt: string): Promise<string>;
  };
}

const CODES: readonly ExtErrorCode[] = [
  'offline',
  'safeMode',
  'network',
  'checksum',
  'io',
  'invalid',
  'model',
  'unavailable',
  'engine',
];

export class ExtError extends Error {
  readonly code: ExtErrorCode;
  constructor(code: ExtErrorCode, message: string) {
    super(message);
    this.name = 'ExtError';
    this.code = code;
  }
}

/** Any rejection as an ExtError. */
export function toExtError(error: unknown): ExtError {
  if (error instanceof ExtError) return error;
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as Record<string, unknown>;
    const known = CODES.find((one) => one === code);
    return new ExtError(known ?? 'unknown', String(message ?? ''));
  }
  return new ExtError('unknown', error instanceof Error ? error.message : String(error));
}

export function createIntelExt(transport: IntelTransport): IntelExt {
  const call = async <T>(method: string, params?: unknown): Promise<T> => {
    try {
      return (await transport.invoke('intel_ext_call', { request: { method, params: params ?? null } })) as T;
    } catch (error) {
      throw toExtError(error);
    }
  };
  return {
    get: (name) => call<string | null>('store.get', { name }),
    put: async (name, text) => void (await call('store.put', { name, text })),
    remove: async (name) => void (await call('store.remove', { name })),
    list: (prefix) => call<string[]>('store.list', { prefix }),
    correctVocabulary: (vocabulary, text) => call<VocabularyCorrection>('vocabulary.correct', { vocabulary, text }),
    models: {
      list: () => call<ModelList>('models.list'),
      start: async (id) => void (await call('models.start', { id })),
      cancel: async (id) => void (await call('models.cancel', { id })),
      remove: async (id) => void (await call('models.remove', { id })),
    },
    engines: { info: () => call<EngineInfo>('engines.info') },
    llm: {
      generate: async (options) => (await call<{ text: string }>('llm.generate', options)).text,
      stop: async () => void (await call('llm.stop')),
    },
    translate: {
      run: async (pack, lines) => (await call<{ lines: string[] }>('translate.run', { pack, lines })).lines,
    },
    embed: {
      run: async (texts) => (await call<{ vectors: number[][] }>('embed.run', { texts })).vectors,
    },
    cloud: {
      status: () => call<CloudStatus[]>('cloud.status'),
      setKey: async (feature, key) => void (await call('cloud.setKey', { feature, key })),
      forget: async (feature) => void (await call('cloud.forget', { feature })),
      summarize: async (text) => (await call<{ summary: string }>('cloud.summarize', { text })).summary,
      tutor: async (system, prompt) => (await call<{ reply: string }>('cloud.tutor', { system, prompt })).reply,
    },
  };
}
