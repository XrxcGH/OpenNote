//! The messages between OpenNote and its language model program (`opennote-llm`).
//!
//! The program runs llama.cpp in a process of its own: llama.cpp and whisper.cpp each bundle their own copy of
//! ggml, and one program cannot hold both. It talks over its standard input and output, one JSON message to a
//! line, and has no network access of its own. The app starts it only when the person has turned on a feature
//! that needs a language model and has downloaded one, and ends it when that stops being true.
//!
//! The text of a note is sent to it as a prompt and the answer comes back as text. Neither is written to disk or
//! logged by the program.

use serde::{Deserialize, Serialize};

/// The most bytes of prompt (system and user text together) the program accepts.
pub const MAX_PROMPT_BYTES: usize = 96 * 1024;
/// The most new tokens one request may ask for.
pub const MAX_NEW_TOKENS: u32 = 1024;
/// The longest line, in bytes, either side reads.
pub const MAX_LINE_BYTES: usize = 256 * 1024;

/// What the app asks the program to do.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Request {
    /// Writes an answer to `prompt`, as the assistant, following `system`.
    #[serde(rename_all = "camelCase")]
    Generate {
        id: u64,
        /// The GGUF model file. The program reads only a file whose name ends in `.gguf`.
        model: String,
        system: String,
        prompt: String,
        max_tokens: u32,
        /// 0 to 1. Low values keep an answer close to the notes.
        temperature: f32,
    },
    /// Ends the program once the current request is done.
    Quit,
}

/// What the program answers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Response {
    /// The program started and can take requests.
    Ready { runtime: String },
    /// The finished answer to request `id`.
    Done { id: u64, text: String },
    /// Request `id` failed. The message is for the log, and the interface picks its own words.
    Failed { id: u64, code: FailureCode, message: String },
}

/// Why a request failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureCode {
    /// The model file is missing or not a model llama.cpp can read.
    Model,
    /// The request is malformed or over a limit.
    Invalid,
    /// The model ran out of memory or stopped.
    Engine,
}

/// Why a request is refused before it is sent, if it is.
pub fn check(request: &Request) -> Result<(), String> {
    let Request::Generate {
        model,
        system,
        prompt,
        max_tokens,
        temperature,
        ..
    } = request
    else {
        return Ok(());
    };
    if !model.to_lowercase().ends_with(".gguf") {
        return Err("The model must be a .gguf file.".to_owned());
    }
    if system.len() + prompt.len() > MAX_PROMPT_BYTES {
        return Err("The prompt is too long.".to_owned());
    }
    if *max_tokens == 0 || *max_tokens > MAX_NEW_TOKENS {
        return Err("The answer length is out of range.".to_owned());
    }
    if !temperature.is_finite() || !(0.0..=1.0).contains(temperature) {
        return Err("The temperature is out of range.".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate(model: &str, prompt: &str, max_tokens: u32, temperature: f32) -> Request {
        Request::Generate {
            id: 1,
            model: model.to_owned(),
            system: "Answer from the notes.".to_owned(),
            prompt: prompt.to_owned(),
            max_tokens,
            temperature,
        }
    }

    #[test]
    fn a_request_round_trips_as_one_json_line() {
        let request = generate("model.gguf", "What is a cell?", 200, 0.2);
        let line = serde_json::to_string(&request).unwrap();
        assert!(!line.contains('\n'));
        assert_eq!(serde_json::from_str::<Request>(&line).unwrap(), request);
        let response = Response::Failed {
            id: 1,
            code: FailureCode::Model,
            message: "no file".to_owned(),
        };
        let line = serde_json::to_string(&response).unwrap();
        assert_eq!(serde_json::from_str::<Response>(&line).unwrap(), response);
    }

    #[test]
    fn limits_are_checked_before_a_request_is_sent() {
        assert!(check(&generate("model.gguf", "hi", 100, 0.5)).is_ok());
        assert!(check(&generate("model.bin", "hi", 100, 0.5)).is_err());
        assert!(check(&generate("model.gguf", "hi", 0, 0.5)).is_err());
        assert!(check(&generate("model.gguf", "hi", MAX_NEW_TOKENS + 1, 0.5)).is_err());
        assert!(check(&generate("model.gguf", "hi", 100, f32::NAN)).is_err());
        assert!(check(&generate("model.gguf", &"x".repeat(MAX_PROMPT_BYTES), 100, 0.5)).is_err());
        assert!(check(&Request::Quit).is_ok());
    }
}
