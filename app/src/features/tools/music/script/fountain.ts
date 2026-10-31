// Fountain, the plain-text screenplay syntax (fountain.io, an open specification): classify each line, lay the script out
// in character cells the way a screenplay or stage play is typed, and count pages, scenes, characters, and locations.
// Everything here is pure; no user text is ever evaluated.

export type ElementType =
  | 'scene'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'centered'
  | 'section'
  | 'synopsis'
  | 'pagebreak'
  | 'lyric';

export interface Element {
  type: ElementType;
  text: string;
  /** The 1-based line of the source where the element starts. */
  line: number;
  /** Which scene the element is in: 0 before the first scene heading. */
  scene: number;
  /** A character cue that ends in ^ is the second voice of a dual dialogue. */
  dual?: boolean;
}

export interface Parsed {
  title: Record<string, string>;
  elements: Element[];
  /** Notes written as [[like this]], with the scene they were in. */
  notes: { scene: number; text: string }[];
}

const TITLE_KEYS = /^(title|credit|author|authors|source|draft date|date|contact|copyright|notes|revision)\s*:/i;
const SCENE_START = /^(int|ext|est|int\.?\s*\/\s*ext|i\s*\/\s*e)[. ]/i;

const isUpper = (text: string): boolean => /[A-Z]/.test(text) && text === text.toUpperCase() && !/[a-z]/.test(text);

/** Takes out boneyard comments, and the notes in double brackets while remembering them. */
function strip(source: string): { lines: string[]; notes: { line: number; text: string }[] } {
  const text = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const noBoneyard = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
  const notes: { line: number; text: string }[] = [];
  const lines = noBoneyard.split('\n').map((raw, index) =>
    raw.replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner: string) => {
      notes.push({ line: index + 1, text: inner.trim() });
      return '';
    }),
  );
  return { lines, notes };
}

export function parseFountain(source: string): Parsed {
  const { lines, notes } = strip(source);
  const title: Record<string, string> = {};
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  if (i < lines.length && TITLE_KEYS.test(lines[i]!)) {
    let key = '';
    while (i < lines.length && lines[i]!.trim() !== '') {
      const line = lines[i]!;
      const m = /^([A-Za-z ]+?)\s*:\s*(.*)$/.exec(line);
      if (m && !/^\s/.test(line)) {
        key = m[1]!.toLowerCase();
        title[key] = m[2]!.trim();
      } else if (key) title[key] = `${title[key]} ${line.trim()}`.trim();
      i++;
    }
  }
  const elements: Element[] = [];
  let scene = 0;
  let inDialogue = false;
  const prevBlank = (n: number): boolean => n === 0 || lines[n - 1]!.trim() === '';
  const nextBlank = (n: number): boolean => n + 1 >= lines.length || lines[n + 1]!.trim() === '';
  const push = (type: ElementType, text: string, line: number, dual?: boolean): void => {
    elements.push({ type, text, line: line + 1, scene, ...(dual ? { dual } : {}) });
  };
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (line === '') {
      inDialogue = false;
      continue;
    }
    if (inDialogue) {
      push(/^\(.*\)$/.test(line) ? 'parenthetical' : 'dialogue', line, i);
      continue;
    }
    if (/^={3,}$/.test(line)) {
      push('pagebreak', '', i);
      continue;
    }
    const first = line[0]!;
    if (first === '#') {
      push('section', line.replace(/^#+\s*/, ''), i);
      continue;
    }
    if (first === '=') {
      push('synopsis', line.replace(/^=\s*/, ''), i);
      continue;
    }
    if (first === '~') {
      push('lyric', line.replace(/^~\s*/, ''), i);
      continue;
    }
    if (first === '!') {
      push('action', line.slice(1), i);
      continue;
    }
    if (first === '@' && !nextBlank(i)) {
      push('character', line.slice(1).replace(/\^$/, '').trim(), i, line.endsWith('^'));
      inDialogue = true;
      continue;
    }
    if (first === '.' && line[1] !== '.' && line.length > 1) {
      scene++;
      push('scene', line.slice(1).trim(), i);
      continue;
    }
    if (first === '>') {
      if (line.endsWith('<')) push('centered', line.slice(1, -1).trim(), i);
      else push('transition', line.slice(1).trim(), i);
      continue;
    }
    if (prevBlank(i) && SCENE_START.test(line)) {
      scene++;
      push('scene', line, i);
      continue;
    }
    if (prevBlank(i) && isUpper(line) && /TO:$/.test(line) && nextBlank(i)) {
      push('transition', line, i);
      continue;
    }
    const cue = line.replace(/\s*\(.*\)\s*\^?$/, '').replace(/\^$/, '');
    if (prevBlank(i) && !nextBlank(i) && isUpper(cue) && !/^[^A-Z]*$/.test(cue)) {
      push('character', line.replace(/\^$/, '').trim(), i, line.endsWith('^'));
      inDialogue = true;
      continue;
    }
    // Plain action: lines that follow directly join the same paragraph.
    const last = elements[elements.length - 1];
    if (last && last.type === 'action' && last.line + last.text.split('\n').length === i + 1 && !prevBlank(i)) {
      last.text += `\n${line}`;
    } else push('action', line, i);
  }
  return {
    title,
    elements,
    notes: notes.map((n) => ({ text: n.text, scene: sceneAtLine(elements, n.line) })),
  };
}

function sceneAtLine(elements: readonly Element[], line: number): number {
  let scene = 0;
  for (const e of elements) {
    if (e.line > line) break;
    scene = e.scene;
  }
  return scene;
}

// --- layout -------------------------------------------------------------------------------------------------------------

export type Layout = 'screenplay' | 'stage';

/** Lines on a page: the one-page-per-minute rule of thumb counts 55 typed lines to a page. */
export const LINES_PER_PAGE = 55;

interface Metrics {
  /** Left margin and width in character cells, counted from the page's left text margin. */
  indent: number;
  width: number;
}

// Courier 12 point is ten characters to the inch. A screenplay's action runs 60 cells wide from the left margin;
// dialogue starts one inch in and is 35 cells wide, the parenthetical 1.6 inches in and 25 wide, the character cue 2.2
// inches in. A stage play sets directions in a narrower column and speeches in a wide one.
const METRICS: Record<Layout, Record<'action' | 'dialogue' | 'parenthetical' | 'character', Metrics>> = {
  screenplay: {
    action: { indent: 0, width: 60 },
    dialogue: { indent: 10, width: 35 },
    parenthetical: { indent: 16, width: 25 },
    character: { indent: 22, width: 38 },
  },
  stage: {
    action: { indent: 15, width: 45 },
    dialogue: { indent: 10, width: 50 },
    parenthetical: { indent: 14, width: 40 },
    character: { indent: 24, width: 36 },
  },
};

export const PAGE_WIDTH = 60;

/** Word-wraps text to a width in characters; a word longer than the width gets its own line. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (current === '') current = word;
      else if (current.length + 1 + word.length <= width) current += ` ${word}`;
      else {
        out.push(current);
        current = word;
      }
    }
    out.push(current);
  }
  return out;
}

export interface Placed {
  /** The text of the line already indented. */
  text: string;
  element: number;
}

export interface Formatted {
  lines: Placed[];
  /** The number of lines every scene starts on, by scene number (1-based), and where it ends. */
  sceneSpans: { scene: number; start: number; end: number }[];
}

const TYPES_WITH_BLOCKS = new Set<ElementType>(['character', 'parenthetical', 'dialogue', 'lyric']);

/** The typed lines of a script, one blank line after every element or dialogue block. */
export function formatScript(parsed: Parsed, layout: Layout = 'screenplay'): Formatted {
  const m = METRICS[layout];
  const lines: Placed[] = [];
  const spans: { scene: number; start: number; end: number }[] = [];
  const add = (indent: number, text: string, element: number): void => {
    lines.push({ text: `${' '.repeat(indent)}${text}`, element });
  };
  parsed.elements.forEach((e, index) => {
    const next = parsed.elements[index + 1];
    if (e.type === 'scene' && (spans.length === 0 || spans[spans.length - 1]!.scene !== e.scene)) {
      const open = spans[spans.length - 1];
      if (open && open.end < 0) open.end = lines.length;
      spans.push({ scene: e.scene, start: lines.length, end: -1 });
    }
    switch (e.type) {
      case 'scene':
        wrap(e.text.toUpperCase(), PAGE_WIDTH).forEach((l) => add(layout === 'stage' ? 15 : 0, l, index));
        break;
      case 'action':
        wrap(e.text, m.action.width).forEach((l) => add(m.action.indent, l, index));
        break;
      case 'lyric':
        wrap(e.text, m.dialogue.width).forEach((l) => add(m.dialogue.indent, `~${l}`, index));
        break;
      case 'character':
        add(m.character.indent, e.text.toUpperCase(), index);
        break;
      case 'parenthetical':
        wrap(e.text, m.parenthetical.width).forEach((l) => add(m.parenthetical.indent, l, index));
        break;
      case 'dialogue':
        wrap(e.text, m.dialogue.width).forEach((l) => add(m.dialogue.indent, l, index));
        break;
      case 'transition': {
        const text = e.text.toUpperCase();
        add(Math.max(0, PAGE_WIDTH - text.length), text, index);
        break;
      }
      case 'centered':
        wrap(e.text, PAGE_WIDTH).forEach((l) => add(Math.max(0, Math.floor((PAGE_WIDTH - l.length) / 2)), l, index));
        break;
      case 'section':
      case 'synopsis':
        return;
      case 'pagebreak': {
        const fill = (LINES_PER_PAGE - (lines.length % LINES_PER_PAGE)) % LINES_PER_PAGE;
        for (let k = 0; k < fill; k++) add(0, '', index);
        return;
      }
    }
    // A blank line closes the element, except inside a dialogue block.
    if (!(TYPES_WITH_BLOCKS.has(e.type) && next && TYPES_WITH_BLOCKS.has(next.type) && next.type !== 'character')) {
      add(0, '', index);
    }
  });
  const open = spans[spans.length - 1];
  if (open && open.end < 0) open.end = lines.length;
  for (let k = 0; k < spans.length - 1; k++) if (spans[k]!.end < 0) spans[k]!.end = spans[k + 1]!.start;
  return { lines, sceneSpans: spans };
}

/** Pages for a count of typed lines, rounded up. */
export const pageCount = (lineCount: number): number => Math.ceil(lineCount / LINES_PER_PAGE);

/** A scene's length in eighths of a page, rounded up, so the scene list reads like a breakdown sheet. */
export const eighthsOf = (lineCount: number): number => Math.max(1, Math.ceil((lineCount * 8) / LINES_PER_PAGE));

/** Eighths as a page length, such as "2 3/8", "5/8", or "1". */
export function eighthsText(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const part = eighths % 8;
  if (part === 0) return String(whole);
  return whole === 0 ? `${part}/8` : `${whole} ${part}/8`;
}

/** The page text with a rule between pages, for showing and inserting. */
export function withPageMarks(lines: readonly Placed[]): string {
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (i > 0 && i % LINES_PER_PAGE === 0) out.push(`—— page ${i / LINES_PER_PAGE + 1} ——`);
    out.push(l.text.replace(/\s+$/, ''));
  });
  return out.join('\n').replace(/\n+$/, '');
}

// --- lists ------------------------------------------------------------------------------------------------------------------

/** The name a character cue stands for: extensions such as (V.O.) and (CONT'D) are dropped. */
export const characterName = (cue: string): string =>
  cue
    .replace(/\(.*?\)/g, '')
    .replace(/\^/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

export interface CharacterEntry {
  name: string;
  /** Dialogue blocks: one for every time the character speaks. */
  speeches: number;
  words: number;
  scenes: number[];
}

export function characters(parsed: Parsed): CharacterEntry[] {
  const map = new Map<string, CharacterEntry>();
  const els = parsed.elements;
  els.forEach((e, i) => {
    if (e.type !== 'character') return;
    const name = characterName(e.text);
    if (name === '') return;
    const entry = map.get(name) ?? { name, speeches: 0, words: 0, scenes: [] };
    entry.speeches++;
    if (e.scene > 0 && !entry.scenes.includes(e.scene)) entry.scenes.push(e.scene);
    for (let k = i + 1; k < els.length && ['parenthetical', 'dialogue'].includes(els[k]!.type); k++) {
      if (els[k]!.type === 'dialogue') entry.words += els[k]!.text.split(/\s+/).filter(Boolean).length;
    }
    map.set(name, entry);
  });
  return [...map.values()].sort((a, b) => b.speeches - a.speeches || a.name.localeCompare(b.name));
}

export interface SceneEntry {
  number: number;
  heading: string;
  /** INT, EXT, or both; empty for a forced heading. */
  setting: string;
  location: string;
  time: string;
  page: number;
  eighths: number;
}

const HEADING = /^(int\.?\s*\/\s*ext|i\s*\/\s*e|int|ext|est)[. ]\s*(.*)$/i;

/** Splits "INT. KITCHEN - NIGHT" into the setting, the place, and the time of day. */
export function splitHeading(text: string): { setting: string; location: string; time: string } {
  const m = HEADING.exec(text.trim());
  const rest = (m ? m[2]! : text).replace(/#[^#]*#\s*$/, '').trim();
  const cut = rest.lastIndexOf(' - ');
  const location = (cut >= 0 ? rest.slice(0, cut) : rest).trim().toUpperCase();
  const time =
    cut >= 0
      ? rest
          .slice(cut + 3)
          .trim()
          .toUpperCase()
      : '';
  const setting = m ? m[1]!.replace(/\s+/g, '').replace(/\./g, '').toUpperCase().replace('I/E', 'INT/EXT') : '';
  return { setting, location, time };
}

export function scenes(parsed: Parsed, formatted: Formatted): SceneEntry[] {
  const out: SceneEntry[] = [];
  for (const span of formatted.sceneSpans) {
    const heading = parsed.elements.find((e) => e.type === 'scene' && e.scene === span.scene)!;
    const parts = splitHeading(heading.text);
    out.push({
      number: span.scene,
      heading: heading.text.toUpperCase(),
      ...parts,
      page: Math.floor(span.start / LINES_PER_PAGE) + 1,
      eighths: eighthsOf(span.end - span.start),
    });
  }
  return out;
}

export interface LocationEntry {
  location: string;
  scenes: number[];
  times: string[];
}

export function locations(list: readonly SceneEntry[]): LocationEntry[] {
  const map = new Map<string, LocationEntry>();
  for (const s of list) {
    const key = s.location;
    const entry = map.get(key) ?? { location: key, scenes: [], times: [] };
    entry.scenes.push(s.number);
    if (s.time && !entry.times.includes(s.time)) entry.times.push(s.time);
    map.set(key, entry);
  }
  return [...map.values()];
}

export interface Breakdown {
  scene: number;
  heading: string;
  cast: string[];
  /** Words in capitals inside action, which a script marks as props and sounds when a character or thing first appears. */
  props: string[];
  notes: string[];
}

export function breakdown(parsed: Parsed, list: readonly SceneEntry[]): Breakdown[] {
  const names = new Set(characters(parsed).map((c) => c.name));
  return list.map((s) => {
    const inScene = parsed.elements.filter((e) => e.scene === s.number);
    const cast = [...new Set(inScene.filter((e) => e.type === 'character').map((e) => characterName(e.text)))].filter(
      (n) => n !== '',
    );
    const props = new Set<string>();
    for (const e of inScene) {
      if (e.type !== 'action') continue;
      for (const match of e.text.match(/\b[A-Z][A-Z0-9'’-]{2,}(?:\s+[A-Z][A-Z0-9'’-]{2,})*\b/g) ?? []) {
        if (!names.has(match) && !/^(INT|EXT|EST|CUT|FADE)$/.test(match)) props.add(match);
      }
    }
    return {
      scene: s.number,
      heading: s.heading,
      cast,
      props: [...props],
      notes: parsed.notes.filter((n) => n.scene === s.number).map((n) => n.text),
    };
  });
}

export const TYPE_LABELS: Record<ElementType, string> = {
  scene: 'scene heading',
  action: 'action',
  character: 'character',
  parenthetical: 'parenthetical',
  dialogue: 'dialogue',
  transition: 'transition',
  centered: 'centered',
  section: 'section',
  synopsis: 'synopsis',
  pagebreak: 'page break',
  lyric: 'lyric',
};
