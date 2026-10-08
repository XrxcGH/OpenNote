// Saved searches: named searches kept on this device. Each viewer keeps their own, so they live in local storage
// and the panel works without them when storage is blocked.

export interface SavedSearch {
  name: string;
  text: string;
  regex: boolean;
  titleOnly: boolean;
  tag: string;
  date: 'any' | 'today' | 'week' | 'month';
  type: 'all' | 'text' | 'table' | 'image' | 'ink';
}

const KEY = 'opennote.savedSearches';
export const MAX_SAVED = 50;

export function loadSaved(): SavedSearch[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is SavedSearch => typeof item?.name === 'string' && typeof item?.text === 'string')
      : [];
  } catch {
    return [];
  }
}

function store(list: SavedSearch[]): SavedSearch[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage is blocked: the list lasts until the panel closes.
  }
  return list;
}

/** Saves a search under its name, replacing one with the same name (ignoring case). */
export function saveSearch(search: SavedSearch): SavedSearch[] {
  const rest = loadSaved().filter((item) => item.name.toLowerCase() !== search.name.toLowerCase());
  return store([...rest, search].slice(-MAX_SAVED).sort((a, b) => a.name.localeCompare(b.name)));
}

export function deleteSaved(name: string): SavedSearch[] {
  return store(loadSaved().filter((item) => item.name !== name));
}
