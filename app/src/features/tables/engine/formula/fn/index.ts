// The function registry (ADR 0060): every family file's functions by name. A family lane edits only its own file;
// adding a family means one import here. Two functions with one name are a mistake, so the registry refuses them.

import { functions as arrays } from './arrays';
import { functions as database } from './database';
import { functions as datetime } from './datetime';
import { functions as engineering } from './engineering';
import { functions as finance } from './finance';
import { functions as info } from './info';
import { functions as logical } from './logical';
import { functions as lookup } from './lookup';
import { functions as math } from './math';
import { functions as regex } from './regex';
import { functions as sheetsCompat } from './sheetsCompat';
import { functions as stats } from './stats';
import { functions as statsCompat } from './statsCompat';
import { functions as text } from './text';
import type { FnSpec2 } from './types';

export type { Env, Family, FnMeta, FnSpec2, Param, ParamGroup, ParamKind } from './types';
export { arity, isGroup, isSpecial, paramsOf } from './types';

const FAMILIES: readonly (readonly FnSpec2[])[] = [
  math,
  arrays,
  stats,
  statsCompat,
  finance,
  text,
  regex,
  datetime,
  lookup,
  logical,
  info,
  engineering,
  database,
  sheetsCompat,
];

/** Builds the registry. Throws when two specs share a name, which a test checks on every run. */
export function buildRegistry(families: readonly (readonly FnSpec2[])[]): ReadonlyMap<string, FnSpec2> {
  const registry = new Map<string, FnSpec2>();
  for (const family of families) {
    for (const spec of family) {
      if (registry.has(spec.name)) throw new Error(`Two functions are named ${spec.name}.`);
      registry.set(spec.name, spec);
    }
  }
  return registry;
}

/** Every function by its name in capitals. */
export const REGISTRY: ReadonlyMap<string, FnSpec2> = buildRegistry(FAMILIES);
