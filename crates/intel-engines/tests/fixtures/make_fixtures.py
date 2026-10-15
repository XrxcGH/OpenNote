"""Builds the tiny ONNX models and tokenizers the tests in crates/intel-engines/tests use.

They have the same inputs, outputs, and file names as the real Marian and MiniLM packs, but a handful of made-up
weights, so the tests can run the whole path (tokenizer, runtime, decoding loop, pooling) with no download.
Run: python make_fixtures.py   (needs the onnx and numpy packages; the output is committed, so tests need neither)
"""

import json
import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

HERE = os.path.dirname(os.path.abspath(__file__))
OPSET = [helper.make_opsetid("", 17)]


def save(model, path):
    model.ir_version = 8
    onnx.checker.check_model(model)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    onnx.save(model, path)


def tensor_input(name, elem, dims):
    return helper.make_tensor_value_info(name, elem, dims)


def word_level(vocab, unk, post):
    return {
        "version": "1.0",
        "truncation": None,
        "padding": None,
        "added_tokens": [
            {"id": vocab[t], "content": t, "single_word": False, "lstrip": False, "rstrip": False,
             "normalized": False, "special": True}
            for t in post["special"]
        ],
        "normalizer": {"type": "Lowercase"},
        "pre_tokenizer": {"type": "Whitespace"},
        "post_processor": {
            "type": "TemplateProcessing",
            "single": post["single"],
            "pair": post["single"],
            "special_tokens": {t: {"id": t, "ids": [vocab[t]], "tokens": [t]} for t in post["special"]},
        },
        "decoder": None,
        "model": {"type": "WordLevel", "vocab": vocab, "unk_token": unk},
    }


def translator():
    vocab = {"<pad>": 0, "</s>": 1, "<unk>": 2, "hello": 3, "world": 4, "hola": 5, "mundo": 6}
    v, h = len(vocab), 4
    emb = numpy_helper.from_array(np.arange(v * h, dtype=np.float32).reshape(v, h) / 10, "emb")
    encoder = helper.make_model(
        helper.make_graph(
            [helper.make_node("Gather", ["emb", "input_ids"], ["last_hidden_state"])],
            "encoder",
            [tensor_input("input_ids", TensorProto.INT64, [1, "s"]),
             tensor_input("attention_mask", TensorProto.INT64, [1, "s"])],
            [tensor_input("last_hidden_state", TensorProto.FLOAT, [1, "s", h])],
            [emb],
        ),
        opset_imports=OPSET,
    )
    # A table of scores for the word after each word: start says hola, hola says mundo, mundo says the end.
    table = np.zeros((v, v), dtype=np.float32)
    table[0, 5] = 9
    table[5, 6] = 9
    table[6, 1] = 9
    table[:, 0] = 20  # The pad word scores best everywhere, and the decoding loop must never choose it.
    decoder = helper.make_model(
        helper.make_graph(
            [helper.make_node("Gather", ["table", "input_ids"], ["logits"])],
            "decoder",
            [tensor_input("encoder_attention_mask", TensorProto.INT64, [1, "s"]),
             tensor_input("input_ids", TensorProto.INT64, [1, "t"]),
             tensor_input("encoder_hidden_states", TensorProto.FLOAT, [1, "s", h])],
            [tensor_input("logits", TensorProto.FLOAT, [1, "t", v])],
            [numpy_helper.from_array(table, "table")],
        ),
        opset_imports=OPSET,
    )
    out = os.path.join(HERE, "translate")
    save(encoder, os.path.join(out, "encoder.onnx"))
    save(decoder, os.path.join(out, "decoder.onnx"))
    post = {"special": ["</s>"], "single": [{"Sequence": {"id": "A", "type_id": 0}},
                                            {"SpecialToken": {"id": "</s>", "type_id": 0}}]}
    with open(os.path.join(out, "tokenizer.json"), "w") as f:
        json.dump(word_level(vocab, "<unk>", post), f)
    with open(os.path.join(out, "config.json"), "w") as f:
        json.dump({"decoder_start_token_id": 0, "eos_token_id": 1, "pad_token_id": 0}, f)
    with open(os.path.join(out, "generation_config.json"), "w") as f:
        json.dump({"max_length": 512}, f)


def embedder():
    words = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "cat", "kitten", "car", "engine", "milk", "bread"]
    vocab = {w: i for i, w in enumerate(words)}
    rng = np.random.default_rng(7)
    rows = rng.normal(size=(len(words), 384)).astype(np.float32)
    rows[vocab["[CLS]"]] = 0
    rows[vocab["[SEP]"]] = 0
    rows[vocab["kitten"]] = rows[vocab["cat"]] + 0.05 * rng.normal(size=384)
    rows[vocab["engine"]] = rows[vocab["car"]] + 0.05 * rng.normal(size=384)
    model = helper.make_model(
        helper.make_graph(
            [helper.make_node("Gather", ["emb", "input_ids"], ["last_hidden_state"])],
            "embedder",
            [tensor_input("input_ids", TensorProto.INT64, [1, "s"]),
             tensor_input("attention_mask", TensorProto.INT64, [1, "s"]),
             tensor_input("token_type_ids", TensorProto.INT64, [1, "s"])],
            [tensor_input("last_hidden_state", TensorProto.FLOAT, [1, "s", 384])],
            [numpy_helper.from_array(rows, "emb")],
        ),
        opset_imports=OPSET,
    )
    out = os.path.join(HERE, "embed")
    save(model, os.path.join(out, "model.onnx"))
    post = {"special": ["[CLS]", "[SEP]"],
            "single": [{"SpecialToken": {"id": "[CLS]", "type_id": 0}}, {"Sequence": {"id": "A", "type_id": 0}},
                       {"SpecialToken": {"id": "[SEP]", "type_id": 0}}]}
    with open(os.path.join(out, "tokenizer.json"), "w") as f:
        json.dump(word_level(vocab, "[UNK]", post), f)


if __name__ == "__main__":
    translator()
    embedder()
