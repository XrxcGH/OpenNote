// The script formatter's modes: the formatted pages, how each line was classified, the scene list, the character and
// location lists, and breakdown sheets seeded from the text.
import { fail, ok, textTable } from '../shared';
import type { KitOk, KitRow, Values } from '../shared';
import {
  TYPE_LABELS,
  breakdown,
  characters,
  eighthsText,
  formatScript,
  locations,
  pageCount,
  parseFountain,
  scenes,
  withPageMarks,
} from './fountain';
import type { Layout, Parsed } from './fountain';

const MAX_CHARS = 300_000;

function read(v: Values): { parsed: Parsed; layout: Layout } {
  const text = v.script ?? '';
  if (text.trim() === '') return fail('scEmpty');
  if (text.length > MAX_CHARS) return fail('scTooLong');
  const parsed = parseFountain(text);
  if (parsed.elements.length === 0) return fail('scEmpty');
  return { parsed, layout: v.layout === 'stage' ? 'stage' : 'screenplay' };
}

const list = (items: readonly string[]): string => (items.length > 0 ? items.join(', ') : '—');

export function formatMode(v: Values): KitOk {
  const { parsed, layout } = read(v);
  const formatted = formatScript(parsed, layout);
  const lineCount = formatted.lines.length;
  const pages = pageCount(lineCount);
  const sceneList = scenes(parsed, formatted);
  return ok({
    rows: [
      { key: 'pagesOut', value: String(pages) },
      { key: 'minutesOut', value: `about ${pages}` },
      { key: 'linesOut', value: String(lineCount) },
      { key: 'sceneCount', value: String(sceneList.length) },
      { key: 'characterCount', value: String(characters(parsed).length) },
    ],
    steps: [
      { key: 'scLayoutSteps', vars: { layout: layout === 'stage' ? 'stage play' : 'screenplay' } },
      { key: 'scPagesSteps', vars: { lines: String(lineCount), pages: String(pages) } },
      { key: 'scTimeSteps', vars: { pages: String(pages) } },
    ],
    answer: `${pages} page${pages === 1 ? '' : 's'} (about ${pages} minute${pages === 1 ? '' : 's'}), ${sceneList.length} scene${sceneList.length === 1 ? '' : 's'}`,
    code: withPageMarks(formatted.lines),
    notes: ['scNoteEstimate', 'scNoteLayout'],
  });
}

export function classifyMode(v: Values): KitOk {
  const { parsed } = read(v);
  const counts = new Map<string, number>();
  for (const e of parsed.elements) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const rows: KitRow[] = [...counts].map(([type, n]) => ({
    key: 'typeCount',
    vars: { type: TYPE_LABELS[type as keyof typeof TYPE_LABELS] },
    value: String(n),
  }));
  const code = parsed.elements
    .map((e) => `${String(e.line).padStart(4)}  ${TYPE_LABELS[e.type].padEnd(14)}${e.text.split('\n')[0]}`)
    .join('\n');
  return ok({
    rows,
    steps: [{ key: 'scClassifyRules' }, { key: 'scClassifyForced' }],
    answer: parsed.elements.map((e) => TYPE_LABELS[e.type]).join(', '),
    code,
    notes: ['scNoteForced'],
  });
}

export function scenesMode(v: Values): KitOk {
  const { parsed, layout } = read(v);
  const formatted = formatScript(parsed, layout);
  const sceneList = scenes(parsed, formatted);
  if (sceneList.length === 0) return fail('scNoScenes');
  const code = textTable(
    [['Scene', 'Page', 'Length', 'Heading'], ...sceneList.map((s) => [String(s.number), String(s.page), eighthsText(s.eighths), s.heading])],
    [8, 6, 8, 0],
  );
  return ok({
    rows: sceneList.map((s) => ({
      key: 'sceneRow' as const,
      vars: { n: String(s.number) },
      value: `page ${s.page}, ${eighthsText(s.eighths)} — ${s.heading}`,
    })),
    steps: [{ key: 'scScenesEighths' }, { key: 'scScenesPage' }],
    answer: sceneList.map((s) => `${s.number}. ${s.heading} (p. ${s.page}, ${eighthsText(s.eighths)})`).join('; '),
    code,
    notes: ['scNoteEstimate'],
  });
}

export function charactersMode(v: Values): KitOk {
  const { parsed } = read(v);
  const cast = characters(parsed);
  if (cast.length === 0) return fail('scNoCharacters');
  return ok({
    rows: cast.map((c) => ({
      key: 'castRow' as const,
      vars: { name: c.name },
      value: `${c.speeches} speech${c.speeches === 1 ? '' : 'es'}, ${c.words} words, scenes ${list(c.scenes.map(String))}`,
    })),
    steps: [{ key: 'scCastCount' }, { key: 'scCastName' }],
    answer: cast.map((c) => `${c.name} ${c.speeches}`).join(', '),
    code: textTable(
      [['Character', 'Speeches', 'Words', 'Scenes'], ...cast.map((c) => [c.name, String(c.speeches), String(c.words), list(c.scenes.map(String))])],
      [18, 10, 8, 0],
    ),
  });
}

export function locationsMode(v: Values): KitOk {
  const { parsed, layout } = read(v);
  const sceneList = scenes(parsed, formatScript(parsed, layout));
  if (sceneList.length === 0) return fail('scNoScenes');
  const places = locations(sceneList);
  return ok({
    rows: places.map((p) => ({
      key: 'placeRow' as const,
      vars: { name: p.location },
      value: `scenes ${p.scenes.join(', ')}${p.times.length > 0 ? `; ${p.times.join(', ')}` : ''}`,
    })),
    steps: [{ key: 'scPlacesSplit' }],
    answer: places.map((p) => `${p.location} (${p.scenes.length})`).join(', '),
    code: textTable(
      [['Location', 'Scenes', 'Times'], ...places.map((p) => [p.location, p.scenes.join(','), p.times.join(', ')])],
      [28, 12, 0],
    ),
  });
}

export function breakdownMode(v: Values): KitOk {
  const { parsed, layout } = read(v);
  const sceneList = scenes(parsed, formatScript(parsed, layout));
  if (sceneList.length === 0) return fail('scNoScenes');
  const sheets = breakdown(parsed, sceneList);
  return ok({
    rows: sheets.map((s) => ({
      key: 'sheetRow' as const,
      vars: { n: String(s.scene) },
      value: `${s.heading}. Cast: ${list(s.cast)}. Props: ${list(s.props)}. Notes: ${list(s.notes)}`,
    })),
    steps: [{ key: 'scBreakdownCast' }, { key: 'scBreakdownProps' }, { key: 'scBreakdownEdit' }],
    answer: sheets.map((s) => `${s.scene}: ${list(s.cast)}`).join('; '),
    code: textTable(
      [
        ['Scene', 'Cast', 'Props', 'Notes'],
        ...sheets.map((s) => [String(s.scene), list(s.cast), list(s.props), list(s.notes)]),
      ],
      [8, 24, 28, 0],
    ),
    notes: ['scNoteBreakdown'],
  });
}
