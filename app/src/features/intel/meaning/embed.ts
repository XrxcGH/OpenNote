// Turning text into a vector that is near the vectors of text about the same thing (Phase 12). This is the built-in
// embedder. It needs no model and no download. It hashes three kinds of feature into a vector of fixed size: whole
// words, after light stemming and a small table of words that mean the same; pairs of words; and the letter triples
// inside long words. So "colour" finds "color", "purchased" finds "buying", and two notes about one topic land near
// each other. A trained model can replace it behind the same `Embedder` shape, without changing the index.

/** The size of a vector. */
export const DIM = 768;

export interface Embedder {
  readonly name: string;
  readonly dim: number;
  embed(text: string): Float32Array;
}

const STOP = new Set(
  (
    'a about above after again all also am an and any are as at be because been before being below between both but by ' +
    'can could did do does doing down during each few for from further had has have having he her here hers him his how ' +
    'i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she ' +
    'should so some such than that the their them then there these they this those through to too under until up very ' +
    'was we were what when where which while who whom why will with would you your yours'
  ).split(' '),
);

/** Words that mean nearly the same. Each group maps to its first word. */
const GROUPS: readonly (readonly string[])[] = [
  ['buy', 'purchase', 'acquire', 'shop', 'order'],
  ['car', 'automobile', 'vehicle', 'auto'],
  ['big', 'large', 'huge', 'enormous', 'great'],
  ['small', 'little', 'tiny', 'minor'],
  ['quick', 'fast', 'rapid', 'speedy', 'swift'],
  ['begin', 'start', 'commence', 'launch', 'kickoff'],
  ['end', 'finish', 'conclude', 'complete', 'terminate'],
  ['help', 'assist', 'aid', 'support'],
  ['show', 'display', 'present', 'demonstrate'],
  ['use', 'utilize', 'employ'],
  ['error', 'mistake', 'bug', 'fault', 'defect', 'flaw'],
  ['problem', 'issue', 'trouble', 'difficulty'],
  ['idea', 'concept', 'notion', 'thought'],
  ['meeting', 'call', 'conference', 'standup', 'sync'],
  ['task', 'todo', 'chore', 'assignment', 'action'],
  ['deadline', 'due', 'cutoff'],
  ['money', 'cash', 'funds', 'budget', 'cost', 'price', 'expense', 'spending'],
  ['doctor', 'physician', 'clinician', 'nurse'],
  ['medicine', 'medication', 'drug', 'pill', 'prescription'],
  ['exam', 'quiz', 'midterm', 'finals'],
  ['homework', 'coursework', 'assignment'],
  ['teacher', 'professor', 'instructor', 'lecturer', 'tutor'],
  ['student', 'pupil', 'learner'],
  ['house', 'home', 'apartment', 'flat', 'residence'],
  ['job', 'career', 'occupation', 'employment', 'profession'],
  ['happy', 'glad', 'joyful', 'pleased', 'delighted'],
  ['sad', 'unhappy', 'upset', 'depressed', 'gloomy'],
  ['angry', 'mad', 'furious', 'annoyed', 'irritated'],
  ['smart', 'intelligent', 'clever', 'bright'],
  ['trip', 'journey', 'travel', 'voyage', 'vacation', 'holiday'],
  ['food', 'meal', 'dinner', 'lunch', 'breakfast', 'snack'],
  ['recipe', 'dish', 'cooking'],
  ['write', 'compose', 'draft', 'author'],
  ['study', 'learn', 'revise', 'review'],
  ['photo', 'picture', 'image', 'photograph'],
  ['phone', 'mobile', 'cellphone', 'smartphone'],
  ['computer', 'laptop', 'pc', 'machine'],
  ['plan', 'schedule', 'agenda', 'roadmap', 'timeline'],
  ['goal', 'objective', 'target', 'aim'],
  ['risk', 'danger', 'hazard', 'threat'],
  ['increase', 'grow', 'rise', 'expand', 'boost', 'raise'],
  ['decrease', 'reduce', 'shrink', 'drop', 'decline', 'lower'],
  ['important', 'essential', 'critical', 'key', 'vital', 'crucial'],
  ['talk', 'speak', 'discuss', 'converse', 'chat'],
  ['think', 'consider', 'ponder', 'reflect'],
  ['fix', 'repair', 'mend', 'patch', 'resolve'],
  ['make', 'create', 'build', 'produce', 'construct'],
  ['experiment', 'trial', 'lab'],
  ['sick', 'ill', 'unwell', 'disease', 'illness'],
  ['friend', 'buddy', 'pal', 'companion'],
  ['boss', 'manager', 'supervisor', 'lead'],
  ['team', 'group', 'squad', 'crew'],
  ['rule', 'policy', 'regulation', 'guideline'],
  ['cheap', 'inexpensive', 'affordable'],
  ['hard', 'difficult', 'tough', 'challenging'],
  ['easy', 'simple', 'straightforward', 'effortless'],
];

/** Removes the most common endings, so "walking", "walked", and "walks" meet. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('ly')) w = w.slice(0, -2);
  if (w.length > 4 && /(.)\1$/.test(w)) w = w.slice(0, -1);
  // A final e goes too, so "purchase" and "purchased" meet.
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

const CANONICAL = new Map<string, string>();
for (const group of GROUPS) {
  const head = stem(group[0] ?? '');
  for (const word of group) if (!CANONICAL.has(stem(word))) CANONICAL.set(stem(word), head);
}

/** The words of the text that carry meaning, stemmed and mapped to the head of their group. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)) {
    const raw = match[0].replace(/['’].*$/, '');
    if (raw.length < 2 || STOP.has(raw)) continue;
    const stemmed = stem(raw);
    out.push(CANONICAL.get(stemmed) ?? stemmed);
  }
  return out;
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The vector for the text, length 1 (or all zeros for text with no words). */
export function embed(text: string): Float32Array {
  const words = tokens(text);
  const features = new Map<string, number>();
  const bump = (feature: string) => features.set(feature, (features.get(feature) ?? 0) + 1);
  words.forEach((word, i) => {
    bump(`w:${word}`);
    const next = words[i + 1];
    if (next) bump(`b:${word} ${next}`);
    if (word.length >= 5) for (let k = 0; k + 3 <= word.length; k += 1) bump(`t:${word.slice(k, k + 3)}`);
  });
  const vector = new Float32Array(DIM);
  for (const [feature, count] of features) {
    const weight = feature.startsWith('w') ? 1 : feature.startsWith('b') ? 0.5 : 0.2;
    const h = hash(feature);
    // The sign comes from a different bit than the slot, so two features that share a slot tend to cancel.
    vector[h % DIM] = (vector[h % DIM] ?? 0) + (h & 0x80000000 ? -1 : 1) * (1 + Math.log(count)) * weight;
  }
  let norm = 0;
  for (const v of vector) norm += v * v;
  const length = Math.sqrt(norm);
  if (length > 0) for (let i = 0; i < DIM; i += 1) vector[i] = (vector[i] ?? 0) / length;
  return vector;
}

/** The cosine of two vectors of length 1, which is their dot product. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += (a[i] ?? 0) * (b[i] ?? 0);
  return total;
}

export const builtInEmbedder: Embedder = { name: 'words and word parts', dim: DIM, embed };
