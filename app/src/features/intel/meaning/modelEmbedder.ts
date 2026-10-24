// The meaning model as an embedder (A3-23). The shell runs it with ONNX Runtime and gives back vectors of 384 numbers
// of length one. It is used only when the person has downloaded the model; the index then holds its vectors, and
// turning it off or removing the model brings the built-in embedder and a fresh index back.
import type { IntelExt } from '../../../services/intel';
import type { BatchEmbedder } from './embed';

export const MODEL_ID = 'meaning-minilm';
export const MODEL_DIM = 384;
/** The most texts sent to the shell in one call. */
const BATCH = 16;

export function createModelEmbedder(ext: Pick<IntelExt, 'embed'>): BatchEmbedder {
  return {
    name: 'meaning model',
    dim: MODEL_DIM,
    async embedMany(texts) {
      const out: Float32Array[] = [];
      for (let at = 0; at < texts.length; at += BATCH) {
        const vectors = await ext.embed.run(texts.slice(at, at + BATCH));
        if (vectors.length !== Math.min(BATCH, texts.length - at)) throw new Error('The model gave the wrong count.');
        for (const vector of vectors) {
          if (vector.length !== MODEL_DIM) throw new Error('The model gave a vector of the wrong size.');
          out.push(Float32Array.from(vector));
        }
      }
      return out;
    },
  };
}
