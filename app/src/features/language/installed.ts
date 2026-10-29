// The other languages this PC can spell-check or recognize, for the picker. English dialects are always offered, so
// this lists only what is installed beyond them. Nothing is opened or downloaded; this only reads what Windows has.

import { useEffect, useState } from 'react';
import { commandContext } from '../../commands/registry';
import { loadApi } from '../intel';
import { ENGLISH_DIALECTS, isEnglish, localeName } from '../../state/language';
import type { LocaleChoice } from '../../state/language';

/** Merges language tags into choices, without English (the dialects cover it) and without duplicates. */
export function otherLanguages(...lists: readonly (readonly string[])[]): LocaleChoice[] {
  const seen = new Set(ENGLISH_DIALECTS.map((choice) => choice.tag.toLowerCase()));
  const out: LocaleChoice[] = [];
  for (const tag of lists.flat()) {
    if (!tag || isEnglish(tag) || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push({ tag, name: localeName(tag) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en-US'));
}

async function spellingTags(): Promise<string[]> {
  try {
    const list = await commandContext('menu').platform.spelling.languages();
    return list.map((language) => language.tag);
  } catch {
    return [];
  }
}

async function recognitionTags(): Promise<string[]> {
  try {
    const api = await loadApi();
    return await (await api.intelClient()).ocrLanguages();
  } catch {
    return [];
  }
}

/** The installed languages beyond English, or null while they are being listed. */
export function useInstalledLanguages(): LocaleChoice[] | null {
  const [found, setFound] = useState<LocaleChoice[] | null>(null);
  useEffect(() => {
    let current = true;
    void Promise.all([spellingTags(), recognitionTags()]).then(([spelling, recognition]) => {
      if (current) setFound(otherLanguages(spelling, recognition));
    });
    return () => {
      current = false;
    };
  }, []);
  return found;
}
