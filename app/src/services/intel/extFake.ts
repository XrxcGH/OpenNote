// A stand-in for the shell's device store and model downloads, for tests and the web platform. Downloads move
// forward when a test calls `tick`, so progress, cancel, and resume can be checked without a timer.
import { ExtError } from './ext';
import { PACKS } from './packs';
import type { CloudFeature, CloudStatus, ModelInfo, ModelList, VocabularyCorrection } from './ext';

export interface FakeExt {
  /** The device store's files. */
  files: Map<string, string>;
  /** Work offline is on. */
  offline: boolean;
  /** Moves every running download forward by `bytes`, finishing the ones that arrive. */
  tick(bytes: number): void;
  /** The method calls received, in order. */
  calls: string[];
  /** The features with a cloud key. The fake keeps only that there is one, as the shell tells the interface. */
  cloudKeys: Set<CloudFeature>;
  /** The texts sent to the cloud summary, for tests. */
  cloudSent: string[];
  handle(request: { method: string; params: unknown }): unknown;
}

type Entry = Pick<ModelInfo, 'id' | 'kind' | 'name' | 'detail' | 'sizeBytes'>;

const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic',
  zh: 'Chinese',
  nl: 'Dutch',
  en: 'English',
  fr: 'French',
  de: 'German',
  hi: 'Hindi',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  pl: 'Polish',
  ru: 'Russian',
  es: 'Spanish',
  sv: 'Swedish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
};

/** The catalog the fake serves, with the real sizes. */
const CATALOG: readonly Entry[] = [
  {
    id: 'speech-tiny-en',
    kind: 'speech',
    name: 'Speech, smallest (English)',
    detail: 'Fastest.',
    sizeBytes: 77_704_715,
  },
  {
    id: 'speech-base-en',
    kind: 'speech',
    name: 'Speech, balanced (English)',
    detail: 'A good mix of speed and accuracy. Recommended.',
    sizeBytes: 147_964_211,
  },
  {
    id: 'speech-small-en',
    kind: 'speech',
    name: 'Speech, accurate (English)',
    detail: 'Most accurate for English, and slower.',
    sizeBytes: 487_614_201,
  },
  {
    id: 'language-small',
    kind: 'language',
    name: 'Writing and Ask, small',
    detail: 'Fast and light. Good for short answers and simple rewrites.',
    sizeBytes: 491_400_032,
  },
  {
    id: 'language-balanced',
    kind: 'language',
    name: 'Writing and Ask, balanced',
    detail: 'Clearer writing and better answers, and slower. Recommended if your computer has 8 GB of memory or more.',
    sizeBytes: 1_117_320_736,
  },
  {
    id: 'meaning-minilm',
    kind: 'meaning',
    name: 'Find by meaning, better',
    detail: 'A small model that reads what your pages mean, so a search can find them by idea and not only by word.',
    sizeBytes: 23_684_031,
  },
  ...PACKS.map(([from, to, sizeBytes]): Entry => ({
    id: `translate-${from}-${to}`,
    kind: 'translate',
    name: `${LANGUAGE_NAMES[from] ?? from} to ${LANGUAGE_NAMES[to] ?? to}`,
    detail: 'Translates on this computer. Nothing is sent anywhere.',
    sizeBytes,
  })),
];

/** The first mishearing each line lists, replaced by its term. The real correction is the Rust crate's. */
function correct(vocabulary: string, text: string): VocabularyCorrection {
  const changes: VocabularyCorrection['changes'] = [];
  let out = text;
  for (const line of vocabulary.split(/\r?\n/)) {
    const [term = '', heard = ''] = line.split('|').map((part) => part.trim());
    const aliases = heard.split(',').map((one) => one.trim());
    for (const alias of aliases.filter(Boolean)) {
      const at = out.toLowerCase().indexOf(alias.toLowerCase());
      if (at < 0) continue;
      const span = { start: at, end: at + alias.length };
      changes.push({ from: out.slice(span.start, span.end), to: term, span });
      out = out.slice(0, span.start) + term + out.slice(span.end);
    }
  }
  return { text: out, changes };
}

const UNHANDLED = Symbol('unhandled');
type Params = Record<string, string>;
type EngineParams = { system?: string; prompt?: string; pack?: string; lines?: string[]; texts?: string[] };

function storeCall(files: Map<string, string>, method: string, p: Params, persistence?: ExtPersistence): unknown {
  if (method === 'store.get') return files.get(p.name ?? '') ?? null;
  if (method === 'store.put') {
    files.set(p.name ?? '', p.text ?? '');
    persistence?.save(files);
    return null;
  }
  if (method === 'store.remove') {
    files.delete(p.name ?? '');
    persistence?.save(files);
    return null;
  }
  return UNHANDLED;
}

function modelCall(
  fake: FakeExt,
  models: Map<string, ModelInfo>,
  lastRan: { at: number | null },
  method: string,
  p: Params,
): unknown {
  const find = (id: string | undefined): ModelInfo => {
    const found = models.get(id ?? '');
    if (!found) throw new ExtError('invalid', 'That model is not in the catalog.');
    return found;
  };
  if (method === 'models.list') {
    const list: ModelList = {
      models: [...models.values()].map((one) => ({ ...one })),
      lastRanUnix: lastRan.at,
      offline: fake.offline,
    };
    return list;
  }
  if (method === 'models.start') {
    if (fake.offline) throw new ExtError('offline', 'Work offline is on.');
    const one = find(p.id);
    if (one.state !== 'installed') {
      one.state = 'downloading';
      one.error = null;
      lastRan.at = Math.floor(Date.now() / 1000);
    }
    return null;
  }
  if (method === 'models.cancel') {
    const one = find(p.id);
    if (one.state === 'downloading') one.state = one.bytes > 0 ? 'partial' : 'notInstalled';
    return null;
  }
  if (method === 'models.remove') {
    Object.assign(find(p.id), { state: 'notInstalled', bytes: 0 });
    return null;
  }
  return UNHANDLED;
}

const installed = (models: Map<string, ModelInfo>, id: string): boolean => models.get(id)?.state === 'installed';

/** Stand-ins for the engines, so the screens and the web preview can be tried without a download. */
function engineCall(models: Map<string, ModelInfo>, method: string, p: EngineParams): unknown {
  if (method === 'engines.info') {
    return {
      whisperCpp: false,
      whisperGpu: false,
      onnx: true,
      llmHost: true,
      languageModel: installed(models, 'language-small') || installed(models, 'language-balanced'),
    };
  }
  if (method === 'llm.generate') {
    if (!installed(models, 'language-small') && !installed(models, 'language-balanced')) {
      throw new ExtError('model', 'No language model is downloaded.');
    }
    return { text: standInAnswer(p.system ?? '', p.prompt ?? '') };
  }
  if (method === 'llm.stop') return null;
  if (method === 'translate.run') {
    const pack = String(p.pack ?? '');
    if (!installed(models, `translate-${pack}`)) throw new ExtError('model', 'That language pack is not downloaded.');
    const to = pack.split('-')[1] ?? '';
    return { lines: (p.lines ?? []).map((line) => (line.trim() === '' ? line : `[${to}] ${line}`)) };
  }
  if (method === 'embed.run') {
    if (!installed(models, 'meaning-minilm')) throw new ExtError('model', 'The meaning model is not downloaded.');
    return { vectors: (p.texts ?? []).map(standInVector) };
  }
  return UNHANDLED;
}

/** A vector of 384 numbers of length one from the words of the text, so equal words land together. */
function standInVector(text: string): number[] {
  const vector = new Array<number>(384).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i += 1) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
    vector[Math.abs(h) % 384] = (vector[Math.abs(h) % 384] ?? 0) + 1;
  }
  const length = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return length === 0 ? vector : vector.map((v) => v / length);
}

/** What a language model might write: the text in the prompt, tidied for a writing tool, or a quote for Ask. */
function standInAnswer(system: string, prompt: string): string {
  const text = /<text>([\s\S]*?)<\/text>/.exec(prompt)?.[1]?.trim();
  if (text !== undefined) {
    const fixed = text.replace(/\bteh\b/gi, 'the').replace(/\s+/g, ' ');
    return fixed.charAt(0).toUpperCase() + fixed.slice(1);
  }
  const passage = /\[1\]\s*([^\n]+)/.exec(prompt)?.[1]?.trim();
  return passage ? `The notes say: ${passage} [1]` : system;
}

function cloudFeature(value: string | undefined): CloudFeature {
  if (value === 'transcription' || value === 'summaries') return value;
  throw new ExtError('invalid', 'That feature can’t use a cloud key.');
}

function cloudCall(fake: FakeExt, used: Map<CloudFeature, number>, method: string, p: Params): unknown {
  if (method === 'cloud.status') {
    return (['transcription', 'summaries'] as const).map((feature): CloudStatus => ({
      feature,
      provider: 'openai',
      host: 'api.openai.com',
      hasKey: fake.cloudKeys.has(feature),
      lastUsedUnix: used.get(feature) ?? null,
    }));
  }
  if (method === 'cloud.setKey') {
    const key = (p.key ?? '').trim();
    if (key.length < 20 || /[^!-~]/.test(key)) throw new ExtError('invalid', 'That doesn’t look like a key.');
    fake.cloudKeys.add(cloudFeature(p.feature));
    return null;
  }
  if (method === 'cloud.forget') {
    fake.cloudKeys.delete(cloudFeature(p.feature));
    return null;
  }
  if (method === 'cloud.summarize') {
    if (fake.offline) throw new ExtError('offline', 'Work offline is on.');
    if (!fake.cloudKeys.has('summaries')) throw new ExtError('invalid', 'No key is saved for this feature.');
    fake.cloudSent.push(p.text ?? '');
    used.set('summaries', Math.floor(Date.now() / 1000));
    return { summary: `Summary: ${(p.text ?? '').split(/(?<=[.!?])\s/)[0] ?? ''}` };
  }
  return UNHANDLED;
}

/** Where a browser keeps the device store between reloads: the web platform passes it, and tests leave it out. */
export interface ExtPersistence {
  load(): Record<string, string>;
  save(files: ReadonlyMap<string, string>): void;
  /** The ids of the models "downloaded" earlier, and a way to remember them again. */
  loadInstalled(): string[];
  saveInstalled(ids: readonly string[]): void;
}

export function createFakeExt(persistence?: ExtPersistence): FakeExt {
  const files = new Map<string, string>(Object.entries(persistence?.load() ?? {}));
  const calls: string[] = [];
  const models = new Map<string, ModelInfo>(
    CATALOG.map((one) => [one.id, { ...one, state: 'notInstalled', bytes: 0, error: null }]),
  );
  for (const id of persistence?.loadInstalled() ?? []) {
    const known = models.get(id);
    if (known) Object.assign(known, { state: 'installed', bytes: known.sizeBytes });
  }
  const rememberInstalled = () =>
    persistence?.saveInstalled([...models.values()].filter((one) => one.state === 'installed').map((one) => one.id));
  const lastRan: { at: number | null } = { at: null };
  const cloudUsed = new Map<CloudFeature, number>();
  const fake: FakeExt = {
    files,
    offline: false,
    calls,
    cloudKeys: new Set(),
    cloudSent: [],
    tick(bytes) {
      for (const model of models.values()) {
        if (model.state !== 'downloading') continue;
        model.bytes = Math.min(model.sizeBytes, model.bytes + bytes);
        if (model.bytes === model.sizeBytes) {
          model.state = 'installed';
          rememberInstalled();
        }
      }
    },
    handle({ method, params }) {
      calls.push(method);
      const p = (params ?? {}) as Params;
      if (method === 'vocabulary.correct') return correct(p.vocabulary ?? '', p.text ?? '');
      const found = [
        storeCall(files, method, p, persistence),
        ...(method.startsWith('models.') ? [modelCall(fake, models, lastRan, method, p)] : []),
        ...(method === 'models.remove' ? [rememberInstalled()] : []),
        ...(method.startsWith('cloud.') ? [cloudCall(fake, cloudUsed, method, p)] : []),
        ...(/^(engines|llm|translate|embed)./.test(method) ? [engineCall(models, method, params as EngineParams)] : []),
      ].find((one) => one !== UNHANDLED);
      if (found === undefined) throw new ExtError('invalid', `There is no method called ${method}.`);
      return found;
    },
  };
  return fake;
}
