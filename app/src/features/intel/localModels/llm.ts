// The language model engines (A3-23): the writing tools and Ask, written by a language model that runs on this
// computer (llama.cpp, in its own program). Neither engine is used before the person downloads a language model.
// Each sits behind its rule-based stand-in (fallback.ts). If the model fails, is too slow to start, or writes
// something that does not fit the request, the stand-in answers instead, and the engine's name says so.
//
// A model can wander. These engines ask for only the edited text, then check the answer before it reaches the screen.
// An empty answer is refused. So is an answer far longer or shorter than the tool allows, and an answer to Ask that
// cites nothing. The stand-in takes over each time.
import type { IntelExt, ModelList } from '../../../services/intel';
import { t } from '../../../strings/t';
import { answerEngine, useAnswerEngine as putAnswerEngine } from '../ask/answer';
import type { AnswerEngine, Passage } from '../ask/answer';
import { useWritingEngine as putWritingEngine, writingEngine } from '../writing/ops';
import type { WritingEngine, WritingResult, WritingTool } from '../writing/ops';
import { withAnswerFallback, withWritingFallback } from './fallback';

/** The most characters of notes sent for one request. A longer selection is refused by the engine. */
export const MAX_INPUT_CHARS = 24_000;

const SYSTEM =
  "You edit the user's own notes. Reply with only the edited text: no introduction, no explanation, no quotation " +
  'marks, no code fence. Keep the language, the names, the numbers, and the meaning of the notes.';

const INSTRUCTIONS: Record<WritingTool, string> = {
  proofread: 'Fix spelling, grammar, and punctuation. Change nothing else.',
  rewrite: 'Rewrite the text so it is clearer and reads smoothly. Keep the meaning and the tone.',
  shorten: 'Make the text about half as long. Keep the important facts and drop the rest.',
  list: 'Turn the text into a Markdown bullet list with one idea in each item. Begin each line with "- ".',
  tidy: 'Tidy the structure: one kind of bullet, steady numbering, and no stray blank lines. Do not change the words.',
};

/** How long the answer may be, as a share of the text it answers. */
const LENGTH: Record<WritingTool, readonly [number, number]> = {
  proofread: [0.6, 1.6],
  rewrite: [0.3, 2],
  shorten: [0.05, 1],
  list: [0.3, 2.5],
  tidy: [0.8, 1.2],
};

/** The answer without the wrapping a model likes to add: a code fence, the tags of the prompt, or quotation marks. */
export function cleanAnswer(raw: string): string {
  let text = raw.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = (fenced[1] ?? '').trim();
  text = text.replace(/^<text>\s*/i, '').replace(/\s*<\/text>$/i, '');
  if (/^"[\s\S]*"$/.test(text) && !text.slice(1, -1).includes('"')) text = text.slice(1, -1);
  return text.trim();
}

export interface Generator {
  generate: IntelExt['llm']['generate'];
}

/** The writing engine over a language model. It throws when the model fails or its answer does not fit. */
export function createLanguageWritingEngine(llm: Generator): WritingEngine {
  return {
    name: t('intelPlus.engines.language'),
    async run(tool, text): Promise<WritingResult> {
      if (text.length > MAX_INPUT_CHARS) throw new Error('The selection is too long for the language model.');
      const answer = cleanAnswer(
        await llm.generate({
          system: `${SYSTEM} ${INSTRUCTIONS[tool]}`,
          prompt: `<text>\n${text}\n</text>`,
          maxTokens: Math.min(1024, Math.ceil(text.length / 2.5) + 64),
          temperature: 0.2,
        }),
      );
      const [least, most] = LENGTH[tool];
      const share = answer.length / Math.max(1, text.trim().length);
      if (answer === '' || share < least || share > most) throw new Error('The answer does not fit the request.');
      return { text: answer, markdown: tool === 'list' || (tool === 'tidy' && /^\s*(?:- |\d+\. )/m.test(answer)) };
    },
  };
}

const ASK_SYSTEM =
  "You answer a question using only the numbered passages from the user's notes. Write one to three short " +
  'sentences. After each statement put the number of the passage it comes from, like [1]. If the passages do not ' +
  'contain the answer, reply with exactly NO_ANSWER.';

/** The most passages sent with a question, and the most characters of each. */
const PASSAGES = 6;
const PASSAGE_CHARS = 700;

/** The answer with its markers renumbered in the order the sources first appear, and the sources they point to. */
export function renumber(text: string, passages: readonly Passage[]): { text: string; sources: Passage[] } | null {
  const order: number[] = [];
  const marked = text.replace(/\[(\d{1,2})\]/g, (_all, digits: string) => {
    const at = Number(digits) - 1;
    if (!passages[at]) return '';
    if (!order.includes(at)) order.push(at);
    return `[${order.indexOf(at) + 1}]`;
  });
  if (order.length === 0) return null;
  return {
    text: marked
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim(),
    sources: order.map((at) => passages[at] as Passage),
  };
}

/** The answer engine over a language model. It throws when the model fails or cites nothing. */
export function createLanguageAnswerEngine(llm: Generator): AnswerEngine {
  return {
    name: t('intelPlus.engines.language'),
    async answer(question, passages) {
      const used = passages.slice(0, PASSAGES);
      const listed = used
        .map((passage, at) => `[${at + 1}] (${passage.title}) ${passage.text.slice(0, PASSAGE_CHARS)}`)
        .join('\n');
      const raw = cleanAnswer(
        await llm.generate({
          system: ASK_SYSTEM,
          prompt: `Passages:\n${listed}\n\nQuestion: ${question}`,
          maxTokens: 300,
          temperature: 0.1,
        }),
      );
      if (/^NO_ANSWER\b/.test(raw) || raw === '') return null;
      const checked = renumber(raw, used);
      // An answer that points at no passage cannot be checked against the notes, so it is not shown.
      if (!checked) throw new Error('The answer cites no passage.');
      return { text: checked.text, sources: checked.sources, quoted: false };
    },
  };
}

let release: (() => void) | null = null;

/** Puts the language model engines in place, each behind its stand-in. Does nothing when they already are. */
export function installLanguageEngines(llm: Generator): void {
  if (release) return;
  const writing = withWritingFallback(createLanguageWritingEngine(llm), writingEngine());
  const answering = withAnswerFallback(createLanguageAnswerEngine(llm), answerEngine());
  const undoWriting = putWritingEngine(writing);
  const undoAnswering = putAnswerEngine(answering);
  release = () => {
    undoWriting();
    undoAnswering();
    release = null;
  };
}

/** Takes the language model engines out, so the rule-based ones answer again. */
export function removeLanguageEngines(): void {
  release?.();
}

export function languageEnginesInstalled(): boolean {
  return release !== null;
}

/** Whether the list shows a language model that is downloaded. */
export function hasLanguageModel(list: ModelList | null): boolean {
  return list?.models.some((one) => one.kind === 'language' && one.state === 'installed') ?? false;
}

/** Puts the engines in or out to match the downloaded models. Quiet when the shell has no language model program. */
export async function syncLanguageEngines(ext: IntelExt, list: ModelList | null): Promise<void> {
  if (!hasLanguageModel(list)) return removeLanguageEngines();
  try {
    const info = await ext.engines.info();
    if (info.languageModel && info.llmHost) installLanguageEngines(ext.llm);
    else removeLanguageEngines();
  } catch {
    // A shell that doesn't know the question has no engine to offer.
    removeLanguageEngines();
  }
}
