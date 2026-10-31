// The people of a family chart, read from a list with one person per line:
//   id, sex, father, mother, marks, label
// Sex is M, F, or U. Marks are words separated by spaces: affected, carrier, proband, deceased, adopted, unknown
// (status not known), partner:ID, twin:ID, mz:ID (identical twin), born:YEAR. The label is free text, such as a name,
// dates, or a title. Partners who have children together need no partner mark.
import { fail } from '../shared';

export type Sex = 'M' | 'F' | 'U';

export interface Person {
  id: string;
  sex: Sex;
  father: string | null;
  mother: string | null;
  affected: boolean;
  carrier: boolean;
  proband: boolean;
  deceased: boolean;
  adopted: boolean;
  /** Affection status not known: left out of pattern checks and probabilities. */
  unknown: boolean;
  partners: string[];
  twin: string | null;
  identical: boolean;
  born: number | null;
  label: string;
  /** Position in the list, for birth order when no year is given. */
  order: number;
}

export interface Family {
  people: Person[];
  byId: Map<string, Person>;
}

const MARKS = new Set(['affected', 'carrier', 'proband', 'deceased', 'adopted', 'unknown']);

export function readFamily(text: string): Family {
  const people: Person[] = [];
  const byId = new Map<string, Person>();
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const cells = line.split(/\t|,/).map((c) => c.trim());
    const [id = '', sexText = 'U', father = '', mother = '', marks = '', ...rest] = cells;
    if (id === '' || /\s/.test(id)) fail('family.e.id', { line });
    if (byId.has(id)) fail('family.e.duplicate', { id });
    const sex = (sexText.toUpperCase() || 'U') as Sex;
    if (!['M', 'F', 'U'].includes(sex)) fail('family.e.sex', { id, sex: sexText });
    const person: Person = {
      id,
      sex,
      father: father || null,
      mother: mother || null,
      affected: false,
      carrier: false,
      proband: false,
      deceased: false,
      adopted: false,
      unknown: false,
      partners: [],
      twin: null,
      identical: false,
      born: null,
      label: rest.join(', '),
      order: people.length,
    };
    for (const word of marks.split(/\s+/).filter(Boolean)) {
      const lower = word.toLowerCase();
      const [key, value = ''] = lower.split(':');
      if (MARKS.has(lower)) (person as unknown as Record<string, boolean>)[lower] = true;
      else if (key === 'partner' && value) person.partners.push(word.slice(8));
      else if ((key === 'twin' || key === 'mz') && value) {
        person.twin = word.slice(key.length + 1);
        person.identical = key === 'mz';
      } else if (key === 'born' && /^-?\d+$/.test(value)) person.born = Number(value);
      else fail('family.e.mark', { id, mark: word });
    }
    people.push(person);
    byId.set(id, person);
  });
  if (people.length === 0) fail('family.e.empty');
  for (const p of people) {
    for (const [role, parent, want] of [
      ['father', p.father, 'M'],
      ['mother', p.mother, 'F'],
    ] as const) {
      if (parent === null) continue;
      const found = byId.get(parent);
      if (!found) fail('family.e.missingParent', { id: p.id, parent });
      if (found!.sex !== want && found!.sex !== 'U') fail(`family.e.${role}Sex`, { id: p.id, parent });
    }
    for (const q of p.partners) {
      const partner = byId.get(q) ?? fail('family.e.missingPartner', { id: p.id, partner: q });
      if (!partner.partners.includes(p.id)) partner.partners.push(p.id);
    }
    if (p.twin !== null && !byId.has(p.twin)) fail('family.e.missingTwin', { id: p.id, twin: p.twin });
  }
  // Parents of the same child are partners.
  for (const p of people) {
    if (p.father && p.mother) {
      const f = byId.get(p.father)!;
      const m = byId.get(p.mother)!;
      if (!f.partners.includes(m.id)) f.partners.push(m.id);
      if (!m.partners.includes(f.id)) m.partners.push(f.id);
    }
  }
  checkCycles(people, byId);
  return { people, byId };
}

function checkCycles(people: readonly Person[], byId: ReadonlyMap<string, Person>): void {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) fail('family.e.cycle', { id });
    state.set(id, 1);
    const p = byId.get(id)!;
    if (p.father) visit(p.father);
    if (p.mother) visit(p.mother);
    state.set(id, 2);
  };
  people.forEach((p) => visit(p.id));
}

export const parentsOf = (family: Family, p: Person): Person[] =>
  [p.father, p.mother].flatMap((id) => (id === null ? [] : [family.byId.get(id)!]));

export const childrenOf = (family: Family, p: Person): Person[] =>
  family.people.filter((c) => c.father === p.id || c.mother === p.id);

/** Children in birth order: by year when given, else in list order. */
export const byBirth = (a: Person, b: Person): number =>
  (a.born ?? Infinity) - (b.born ?? Infinity) || a.order - b.order;
