// Whether the person has switched an on-device feature on, for a command's `when`, which cannot wait. The choices
// load once, soon after start-up, from the intel feature's lazy api; until then every feature reads as off, so its
// commands stay out of the palette (walk 9, T1-D05-4).
import { loadApi } from '../../intel';

type Api = Awaited<ReturnType<typeof loadApi>>;

let api: Api | null = null;

void loadApi().then(async (loaded) => {
  await Promise.all([loaded.loadIntel(), loaded.loadExtras()]);
  api = loaded;
});

export const featureOn = (feature: Parameters<Api['isOn']>[0]): boolean => api?.isOn(feature) ?? false;
export const extraOn = (feature: Parameters<Api['isExtraOn']>[0]): boolean => api?.isExtraOn(feature) ?? false;
