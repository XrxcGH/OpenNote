// Engines that need a downloaded model (A3-23). A language model can write and answer in fluent sentences, but it can
// fail: the model file is gone, memory runs short, or the runtime stops. Writing tools and Ask must keep working
// then, so a model engine goes in behind its rule-based stand-in. If the model engine throws, the stand-in answers
// the same request, and the engine's name says which one wrote it. Nothing here loads a model or touches a network.
import { lexicalEngine } from '../ask/answer';
import type { AnswerEngine } from '../ask/answer';
import { ruleBasedEngine } from '../writing/ops';
import type { WritingEngine } from '../writing/ops';

/** `primary`, with the rule-based writing engine answering whenever `primary` throws. */
export function withWritingFallback(primary: WritingEngine, fallback: WritingEngine = ruleBasedEngine): WritingEngine {
  let fell = false;
  return {
    get name() {
      return fell ? fallback.name : primary.name;
    },
    async run(tool, text) {
      try {
        const result = await primary.run(tool, text);
        fell = false;
        return result;
      } catch {
        fell = true;
        return fallback.run(tool, text);
      }
    },
  };
}

/** `primary`, with the quoting engine answering whenever `primary` throws. */
export function withAnswerFallback(primary: AnswerEngine, fallback: AnswerEngine = lexicalEngine): AnswerEngine {
  let fell = false;
  return {
    get name() {
      return fell ? fallback.name : primary.name;
    },
    async answer(question, passages) {
      try {
        const result = await primary.answer(question, passages);
        fell = false;
        return result;
      } catch {
        fell = true;
        return fallback.answer(question, passages);
      }
    },
  };
}
