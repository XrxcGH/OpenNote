// The language model engines (A3-23): what they ask the model, what they refuse to show, and that the rule-based
// engines answer when the model fails or is taken away. The model itself is a stand-in here.
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeIntelTransport, createIntelExt } from '../../../services/intel';
import type { GenerateOptions } from '../../../services/intel';
import { answerEngine, lexicalEngine } from '../ask/answer';
import type { Passage } from '../ask/answer';
import { ruleBasedEngine, writingEngine } from '../writing/ops';
import {
  cleanAnswer,
  createLanguageAnswerEngine,
  createLanguageWritingEngine,
  hasLanguageModel,
  installLanguageEngines,
  languageEnginesInstalled,
  removeLanguageEngines,
  renumber,
  syncLanguageEngines,
} from './llm';

const passages: Passage[] = [
  { pageId: 'trip', title: 'Trip', block: 'b1', text: 'The flight to Rome leaves at 9 on Friday.', score: 0.6 },
  { pageId: 'class', title: 'Biology', block: 'b2', text: 'The exam covers cells and energy.', score: 0.4 },
];

function writer(answer: string) {
  const asked: GenerateOptions[] = [];
  return { asked, generate: (options: GenerateOptions) => (asked.push(options), Promise.resolve(answer)) };
}

beforeEach(() => removeLanguageEngines());

describe('cleanAnswer', () => {
  it('takes off a code fence, the prompt tags, and quotation marks', () => {
    expect(cleanAnswer('```\nHello there.\n```')).toBe('Hello there.');
    expect(cleanAnswer('<text>\nHello there.\n</text>')).toBe('Hello there.');
    expect(cleanAnswer('"Hello there."')).toBe('Hello there.');
    expect(cleanAnswer('  "She said "hi" to me."  ')).toBe('"She said "hi" to me."');
    expect(cleanAnswer('Plain.')).toBe('Plain.');
  });
});

describe('the writing engine', () => {
  const text = 'Teh meeting is at 9. We should definately review the plan.';

  it('asks for only the edited text, with the tool named in the instruction and the notes inside tags', async () => {
    const llm = writer('The meeting is at 9. We should definitely review the plan.');
    const result = await createLanguageWritingEngine(llm).run('proofread', text);
    expect(result).toEqual({ text: 'The meeting is at 9. We should definitely review the plan.', markdown: false });
    expect(llm.asked[0]?.system).toMatch(/spelling, grammar, and punctuation/);
    expect(llm.asked[0]?.prompt).toBe(`<text>\n${text}\n</text>`);
    expect(llm.asked[0]?.temperature).toBeLessThanOrEqual(0.3);
  });

  it('marks a list as Markdown, and a tidied structure only when it has bullets', async () => {
    const list = await createLanguageWritingEngine(writer('- Milk\n- Bread')).run('list', 'milk and bread');
    expect(list.markdown).toBe(true);
    const tidy = await createLanguageWritingEngine(writer('- one\n- two')).run('tidy', '* one\n* two');
    expect(tidy.markdown).toBe(true);
    const plain = await createLanguageWritingEngine(writer('one two')).run('tidy', 'one two');
    expect(plain.markdown).toBe(false);
  });

  it('refuses an answer that is empty, far too long, or too short for the tool', async () => {
    const run = (answer: string, tool: 'proofread' | 'shorten') =>
      createLanguageWritingEngine(writer(answer)).run(tool, text);
    await expect(run('', 'proofread')).rejects.toThrow();
    await expect(run('x'.repeat(text.length * 3), 'proofread')).rejects.toThrow();
    await expect(run('Ok.', 'proofread')).rejects.toThrow();
    await expect(run(`${text} And much more besides that was never there.`, 'shorten')).rejects.toThrow();
    await expect(run('The meeting is at 9.', 'shorten')).resolves.toMatchObject({ text: 'The meeting is at 9.' });
  });

  it('does not send a selection longer than the model takes', async () => {
    const llm = writer('x');
    await expect(createLanguageWritingEngine(llm).run('rewrite', 'a'.repeat(30_000))).rejects.toThrow();
    expect(llm.asked).toHaveLength(0);
  });
});

describe('the answer engine', () => {
  it('sends the numbered passages and the question, and keeps the markers that point at real passages', async () => {
    const llm = writer('The flight leaves at 9 on Friday [1]. The exam is separate [2] [7].');
    const answer = await createLanguageAnswerEngine(llm).answer('When does the flight leave?', passages);
    expect(answer).toEqual({
      text: 'The flight leaves at 9 on Friday [1]. The exam is separate [2].',
      sources: [passages[0], passages[1]],
      quoted: false,
    });
    expect(llm.asked[0]?.prompt).toContain('[1] (Trip) The flight to Rome');
    expect(llm.asked[0]?.prompt).toContain('Question: When does the flight leave?');
  });

  it('numbers the sources in the order they first appear', () => {
    const done = renumber('The exam [2] comes before the flight [1], as the exam [2] says.', passages);
    expect(done?.text).toBe('The exam [1] comes before the flight [2], as the exam [1] says.');
    expect(done?.sources).toEqual([passages[1], passages[0]]);
    expect(renumber('No markers here.', passages)).toBeNull();
  });

  it('answers nothing when the model says the notes do not hold the answer, and refuses an answer with no citation', async () => {
    expect(await createLanguageAnswerEngine(writer('NO_ANSWER')).answer('Who won?', passages)).toBeNull();
    await expect(createLanguageAnswerEngine(writer('It leaves at 9.')).answer('When?', passages)).rejects.toThrow();
  });
});

describe('installing the engines', () => {
  it('puts them behind the rule-based ones, and takes them out again', async () => {
    expect(writingEngine()).toBe(ruleBasedEngine);
    installLanguageEngines(writer('x'));
    expect(languageEnginesInstalled()).toBe(true);
    expect(writingEngine()).not.toBe(ruleBasedEngine);
    expect(answerEngine()).not.toBe(lexicalEngine);
    removeLanguageEngines();
    expect(writingEngine()).toBe(ruleBasedEngine);
    expect(answerEngine()).toBe(lexicalEngine);
  });

  it('lets the rules answer, and says so in the name, when the model fails', async () => {
    installLanguageEngines({ generate: () => Promise.reject(new Error('The model stopped.')) });
    const result = await writingEngine().run('proofread', 'Teh plan is set.');
    expect(result.text).toBe('The plan is set.');
    expect(writingEngine().name).toBe(ruleBasedEngine.name);
    const answer = await answerEngine().answer('When does the flight to Rome leave?', passages);
    expect(answer?.quoted).toBe(true);
    expect(answerEngine().name).toBe(lexicalEngine.name);
  });
});

describe('following the downloaded models', () => {
  async function setup() {
    const transport = createFakeIntelTransport();
    const ext = createIntelExt(transport);
    return { transport, ext };
  }

  it('does nothing until a language model is downloaded', async () => {
    const { ext } = await setup();
    const list = await ext.models.list();
    expect(hasLanguageModel(list)).toBe(false);
    await syncLanguageEngines(ext, list);
    expect(languageEnginesInstalled()).toBe(false);
  });

  it('installs the engines once a model is downloaded and removes them when it is removed', async () => {
    const { transport, ext } = await setup();
    await ext.models.start('language-small');
    transport.ext.tick(1e12);
    await syncLanguageEngines(ext, await ext.models.list());
    expect(languageEnginesInstalled()).toBe(true);
    // The stand-in model fixes the text between the tags, so the whole path from the engine to the shell answers.
    expect((await writingEngine().run('proofread', 'teh plan is set')).text).toBe('The plan is set');
    await ext.models.remove('language-small');
    await syncLanguageEngines(ext, await ext.models.list());
    expect(languageEnginesInstalled()).toBe(false);
  });

  it('refuses to generate before a model is downloaded, with the code the screens understand', async () => {
    const { ext } = await setup();
    await expect(ext.llm.generate({ system: 's', prompt: 'p' })).rejects.toMatchObject({ code: 'model' });
  });
});
