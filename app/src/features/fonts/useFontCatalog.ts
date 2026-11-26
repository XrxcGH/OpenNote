// Loads the device's font list once and joins it with the recent fonts and the person's substitutions.
import { useEffect, useMemo, useState } from 'react';
import type { FontFamily, FontsClient } from '../../platform/types';
import { useStore } from '../../state/store';
import { recentFonts, substitutions } from './recent';
import { createCatalog } from './service';
import type { FontCatalog, ThemeFonts } from './service';

export function useFontCatalog(client: FontsClient, theme?: Partial<ThemeFonts>): FontCatalog {
  const [families, setFamilies] = useState<readonly FontFamily[]>([]);
  const recent = useStore(recentFonts, (now) => now);
  const own = useStore(substitutions, (now) => now);
  useEffect(() => {
    let live = true;
    client.list().then(
      (list) => live && setFamilies(list),
      () => undefined, // No list: the picker shows the theme fonts and the bundled ones.
    );
    return () => {
      live = false;
    };
  }, [client]);
  const body = theme?.body;
  const heading = theme?.heading;
  const mono = theme?.mono;
  return useMemo(
    () => createCatalog({ families, theme: { body, heading, mono }, substitutions: own, recent }),
    [families, body, heading, mono, own, recent],
  );
}
