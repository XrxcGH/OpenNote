// The Privacy panel's line for cloud keys (A1-33): which features send their input to a cloud service with the
// person's own key, the host, and when it last ran. It loads the cloud code only when the panel shows.
import { useEffect, useState } from 'react';
import type { CloudFeature } from '../../../services/intel';

export interface CloudKeyUse {
  /** The features that run on a cloud service, with the host each one sends to. */
  features: { feature: CloudFeature; host: string }[];
  /** An ISO time when a cloud service was last used, or null. */
  lastRan: string | null;
}

export function useCloudKeyUse(): CloudKeyUse {
  const [use, setUse] = useState<CloudKeyUse>({ features: [], lastRan: null });
  useEffect(() => {
    let current = true;
    void import('./store')
      .then(async (store) => {
        const state = await store.loadCloud(true);
        const features = store.CLOUD_FEATURES.filter((feature) => store.usesCloud(feature, state)).map((feature) => ({
          feature,
          host: store.hostOf(feature, state),
        }));
        const last = Math.max(0, ...(state.status ?? []).map((one) => one.lastUsedUnix ?? 0));
        if (current) setUse({ features, lastRan: last > 0 ? new Date(last * 1000).toISOString() : null });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return use;
}
