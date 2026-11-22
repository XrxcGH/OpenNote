// What the formula bar, autocomplete, and the Insert function dialog know about each function: its family, its
// parameters (from FnSpec2), and the description people read (from the fn* string files, in our own words).
// The family files store descriptions in one of two shapes: {summary, args} or {description, params}.
import { en } from '../../../../strings/en';
import { fnKey } from '../../../../strings/fnKey';
import { REGISTRY, isGroup } from '../../engine/formula/fn';
import type { Family, FnSpec2 } from '../../engine/formula/fn';

export interface FnInfo {
  readonly name: string;
  readonly family: Family;
  readonly signature: string;
  readonly example: string;
  /** One line about the function, or an empty text when no family file describes it. */
  readonly summary: string;
  /** One line about each argument, by its name. */
  readonly args: Readonly<Record<string, string>>;
}

type Described = {
  summary?: string;
  description?: string;
  args?: Record<string, string>;
  params?: Record<string, string>;
};

/** The description of a function from whichever fn* string file holds it. */
function described(name: string): Described | undefined {
  const key = fnKey(name);
  for (const [space, texts] of Object.entries(en)) {
    if (!space.startsWith('fn')) continue;
    const found = (texts as Record<string, unknown>)[key];
    if (found && typeof found === 'object') return found as Described;
  }
  return undefined;
}

const infos = new Map<string, FnInfo>();

/** What is known about a function, by its name in any case, or undefined for a name no family holds. */
export function fnInfo(name: string): FnInfo | undefined {
  const upper = name.toUpperCase();
  const known = infos.get(upper);
  if (known) return known;
  const spec = REGISTRY.get(upper);
  if (!spec) return undefined;
  const text = described(upper);
  const info: FnInfo = {
    name: spec.name,
    family: spec.family,
    signature: spec.meta.signature,
    example: spec.meta.example,
    summary: text?.summary ?? text?.description ?? '',
    args: text?.args ?? text?.params ?? {},
  };
  infos.set(upper, info);
  return info;
}

/** Every function name, in alphabetical order. */
export function allFunctions(): string[] {
  return [...REGISTRY.keys()].sort();
}

export const specOf = (name: string): FnSpec2 | undefined => REGISTRY.get(name.toUpperCase());

/** One part of a hint: an argument's name as shown, whether it may be left out, and whether it repeats. */
export interface HintPart {
  readonly name: string;
  readonly optional: boolean;
  readonly repeat: boolean;
}

/** The parts a hint lists, with each repeating group shown once. */
export function hintParts(spec: FnSpec2): HintPart[] {
  return spec.params.flatMap((param): HintPart[] =>
    isGroup(param)
      ? param.repeat.map((p) => ({
          name: p.name,
          optional: (param.min ?? 0) === 0 || p.optional === true,
          repeat: true,
        }))
      : [{ name: param.name, optional: param.optional === true, repeat: false }],
  );
}

/**
 * Which part of the hint an argument (zero-based) falls on. Arguments past the fixed ones cycle through the
 * repeating group. -1 when the function takes no argument there.
 */
export function partOfArg(spec: FnSpec2, arg: number): number {
  let index = 0;
  let parts = 0;
  for (const param of spec.params) {
    if (isGroup(param)) {
      const size = param.repeat.length;
      if (size === 0) continue;
      return arg >= index ? parts + ((arg - index) % size) : -1;
    }
    if (arg === index) return parts;
    index += 1;
    parts += 1;
  }
  return -1;
}
