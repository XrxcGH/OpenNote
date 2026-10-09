// A stand-in for the shell's device store and model downloads, for tests and the web platform. Downloads move
// forward when a test calls `tick`, so progress, cancel, and resume can be checked without a timer.
import { ExtError } from './ext';
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

function storeCall(files: Map<string, string>, method: string, p: Params): unknown {
  if (method === 'store.get') return files.get(p.name ?? '') ?? null;
  if (method === 'store.put') {
    files.set(p.name ?? '', p.text ?? '');
    return null;
  }
  if (method === 'store.remove') {
    files.delete(p.name ?? '');
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

export function createFakeExt(): FakeExt {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const models = new Map<string, ModelInfo>(
    CATALOG.map((one) => [one.id, { ...one, state: 'notInstalled', bytes: 0, error: null }]),
  );
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
        if (model.bytes === model.sizeBytes) model.state = 'installed';
      }
    },
    handle({ method, params }) {
      calls.push(method);
      const p = (params ?? {}) as Params;
      if (method === 'vocabulary.correct') return correct(p.vocabulary ?? '', p.text ?? '');
      const found = [
        storeCall(files, method, p),
        ...(method.startsWith('models.') ? [modelCall(fake, models, lastRan, method, p)] : []),
        ...(method.startsWith('cloud.') ? [cloudCall(fake, cloudUsed, method, p)] : []),
      ].find((one) => one !== UNHANDLED);
      if (found === undefined) throw new ExtError('invalid', `There is no method called ${method}.`);
      return found;
    },
  };
  return fake;
}
