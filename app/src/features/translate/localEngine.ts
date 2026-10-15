// The translation engine over the language packs the shell downloads (A3-25). The packs are listed by the shell's
// model catalog, a download starts only from the dialog's Download button after the person saw the size, and the
// translation itself runs in the shell with ONNX Runtime. Nothing is sent anywhere.
import { toExtError } from '../../services/intel';
import type { IntelExt, ModelInfo } from '../../services/intel';
import { packFor } from './engine';
import type { LanguagePack, TranslationEngine } from './engine';

const PREFIX = 'translate-';

/** How often the download is read while it runs. */
export const POLL_MS = 600;

/** The pack a catalog entry stands for, or null for anything else. */
export function packOf(model: ModelInfo): LanguagePack | null {
  if (model.kind !== 'translate' || !model.id.startsWith(PREFIX)) return null;
  const [from, to] = model.id.slice(PREFIX.length).split('-');
  if (!from || !to) return null;
  return { id: `${from}-${to}`, from, to, name: model.name, size: model.sizeBytes };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createLocalTranslationEngine(ext: () => Promise<IntelExt>): TranslationEngine {
  const read = async () => (await ext()).models.list();
  const packsIn = (models: readonly ModelInfo[]) => models.flatMap((one) => packOf(one) ?? []);
  return {
    name: 'language packs',
    async packs() {
      return packsIn((await read()).models);
    },
    async installed() {
      const list = await read();
      return new Set(list.models.filter((one) => one.state === 'installed').flatMap((one) => packOf(one)?.id ?? []));
    },
    async install(pack, onProgress) {
      const host = await ext();
      await host.models.start(`${PREFIX}${pack.id}`);
      for (;;) {
        await sleep(POLL_MS);
        const one = (await host.models.list()).models.find((model) => model.id === `${PREFIX}${pack.id}`);
        if (!one) throw new Error('That language pack is not offered.');
        onProgress?.(Math.min(1, one.bytes / Math.max(1, one.sizeBytes)));
        if (one.state === 'installed') return;
        if (one.state === 'failed' || one.state === 'notInstalled' || one.state === 'partial') {
          throw new Error(one.error ?? 'The download stopped.');
        }
      }
    },
    async remove(pack) {
      await (await ext()).models.remove(`${PREFIX}${pack.id}`);
    },
    async translate(lines, from, to) {
      const host = await ext();
      const list = await host.models.list();
      const installed = list.models.filter((one) => one.state === 'installed');
      const pack = packFor(packsIn(installed), from, to);
      if (!pack) throw new Error('That language pack is not downloaded.');
      try {
        return await host.translate.run(pack.id, lines);
      } catch (error) {
        throw new Error(toExtError(error).message, { cause: error });
      }
    },
  };
}

/** Whether this install can run translation: the shell has ONNX Runtime built in. */
export async function canTranslate(ext: () => Promise<IntelExt>): Promise<boolean> {
  try {
    return (await (await ext()).engines.info()).onnx;
  } catch {
    return false;
  }
}
