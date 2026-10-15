//! Runs the whole ONNX path on the tiny models in `tests/fixtures`: tokenizer, runtime, decoding loop, and pooling.
//! The models have made-up weights, so these tests check that the pieces fit, not that a translation is good. How
//! good the real packs are can only be seen with a downloaded pack; see `a_real_pack_translates` below.
#![cfg(feature = "onnx")]

use std::path::{Path, PathBuf};

use opennote_intel_engines::onnx::{Embedder, OnnxError, Translator, EMBED_DIM};

fn fixtures(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[test]
fn the_translator_runs_encoder_decoder_and_tokenizer_end_to_end() {
    let translator = Translator::open(&fixtures("translate")).unwrap();
    // The stand-in decoder always says the same two words, whatever the source is.
    assert_eq!(translator.translate_line("hello world").unwrap(), "hola mundo");
    let lines = vec!["hello".to_owned(), "   ".to_owned(), String::new(), "world hello".to_owned()];
    let done = translator.translate(&lines).unwrap();
    assert_eq!(done, vec!["hola mundo", "   ", "", "hola mundo"]);
}

#[test]
fn a_pack_with_a_missing_file_does_not_open() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["encoder.onnx", "tokenizer.json", "config.json"] {
        std::fs::copy(fixtures("translate").join(name), dir.path().join(name)).unwrap();
    }
    let error = Translator::open(dir.path()).err().expect("no decoder");
    assert!(matches!(error, OnnxError::Model(_)), "{error:?}");
    std::fs::write(dir.path().join("decoder.onnx"), b"not a model").unwrap();
    assert!(matches!(Translator::open(dir.path()).err(), Some(OnnxError::Model(_))));
}

#[test]
fn the_embedder_gives_unit_vectors_and_puts_near_meanings_near() {
    let embedder = Embedder::open(&fixtures("embed")).unwrap();
    let vectors = embedder
        .embed(&["cat".to_owned(), "kitten".to_owned(), "milk".to_owned(), "Cat".to_owned()])
        .unwrap();
    for vector in &vectors {
        assert_eq!(vector.len(), EMBED_DIM);
        assert!((dot(vector, vector) - 1.0).abs() < 1e-4);
    }
    assert!(dot(&vectors[0], &vectors[1]) > 0.9, "a cat and a kitten are near");
    assert!(dot(&vectors[0], &vectors[2]).abs() < 0.4, "a cat and milk are not");
    assert!((dot(&vectors[0], &vectors[3]) - 1.0).abs() < 1e-4, "letter case does not matter");
}

#[test]
fn text_with_no_words_gives_zeros_and_the_same_text_gives_the_same_vector() {
    let embedder = Embedder::open(&fixtures("embed")).unwrap();
    assert!(embedder.embed_one("   ").unwrap().iter().all(|v| *v == 0.0));
    assert_eq!(embedder.embed_one("car engine").unwrap(), embedder.embed_one("car engine").unwrap());
}

/// Runs only when `OPENNOTE_TRANSLATE_PACK` names a downloaded pack folder (such as `translate-en-es` in the
/// models folder), so the owner can see the quality of a real pack. No pack is downloaded by the tests.
#[test]
fn a_real_pack_translates() {
    let Some(dir) = std::env::var_os("OPENNOTE_TRANSLATE_PACK") else {
        return;
    };
    let translator = Translator::open(Path::new(&dir)).unwrap();
    let done = translator.translate_line("Good morning. Where is the library?").unwrap();
    assert!(!done.is_empty());
    println!("{done}");
}
