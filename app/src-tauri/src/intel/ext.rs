//! The one command behind the quality-of-life parts of on-device intelligence (Phase 12): model downloads and a
//! small store for the lists and indexes the interface keeps on this device. Each call names a method, so a new
//! method needs no new command, capability, or permission. Nothing here reads a note, and the store holds only what
//! the interface hands it.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use serde_json::{json, Value};

use super::models::{DownloadError, Models};
use crate::{
    ipc::{codes, IpcError},
    settings::file::write_atomic,
};

/// The most text one stored item may hold.
const MAX_STORED_BYTES: usize = 16 * 1024 * 1024;

/// A call from the interface: the method and its arguments.
#[derive(Debug, Clone, Deserialize)]
pub struct ExtRequest {
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// The state behind the calls.
#[derive(Clone)]
pub struct Ext {
    store: PathBuf,
    models: Models,
}

fn invalid(message: &str, field: &str) -> IpcError {
    IpcError {
        code: codes::INVALID.to_owned(),
        message: message.to_owned(),
        field: Some(field.to_owned()),
    }
}

fn io_error(error: &io::Error) -> IpcError {
    IpcError::new(codes::IO, error.to_string())
}

fn text<'a>(params: &'a Value, key: &str) -> Result<&'a str, IpcError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("A text argument is missing.", key))
}

/// A stored item's file name must be a plain name, so a call cannot reach outside the store.
fn store_name(name: &str) -> Result<&str, IpcError> {
    let plain = !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if plain {
        Ok(name)
    } else {
        Err(invalid(
            "A stored name has letters, digits, dots, dashes, and underscores only.",
            "name",
        ))
    }
}

impl Ext {
    /// `device` is this device's folder. The store and the models live beneath it.
    pub fn new(device: &Path) -> Ext {
        Ext::with_models(device, Models::new(device.join("models")))
    }

    pub fn with_models(device: &Path, models: Models) -> Ext {
        Ext {
            store: device.join("intel"),
            models,
        }
    }

    fn file(&self, name: &str) -> Result<PathBuf, IpcError> {
        Ok(self.store.join(store_name(name)?))
    }

    fn download_error(error: &DownloadError) -> IpcError {
        let code = match error {
            DownloadError::Disk(_) => codes::IO,
            other => other.code(),
        };
        IpcError::new(code, format!("{error:?}"))
    }

    /// Runs one method. `offline` and `safe_mode` come from the app, so tests can set them.
    pub fn call(&self, request: &ExtRequest, offline: bool, safe_mode: bool) -> Result<Value, IpcError> {
        let params = &request.params;
        match request.method.as_str() {
            "store.get" => match fs::read_to_string(self.file(text(params, "name")?)?) {
                Ok(content) => Ok(json!(content)),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Value::Null),
                Err(error) => Err(io_error(&error)),
            },
            "store.put" => {
                let content = text(params, "text")?;
                if content.len() > MAX_STORED_BYTES {
                    return Err(invalid("That is too much to store.", "text"));
                }
                write_atomic(&self.file(text(params, "name")?)?, content.as_bytes())
                    .map_err(|error| io_error(&error))?;
                Ok(Value::Null)
            }
            "store.remove" => match fs::remove_file(self.file(text(params, "name")?)?) {
                Ok(()) => Ok(Value::Null),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Value::Null),
                Err(error) => Err(io_error(&error)),
            },
            "vocabulary.correct" => {
                let request: opennote_intel::wire::VocabularyCorrectRequest =
                    serde_json::from_value(params.clone()).map_err(|error| invalid(&error.to_string(), "params"))?;
                serde_json::to_value(request.correct())
                    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
            }
            "models.list" => serde_json::to_value(self.models.list())
                .map(|mut list| {
                    list["offline"] = json!(offline);
                    list
                })
                .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string())),
            "models.start" => {
                let blocked = if safe_mode {
                    Some(DownloadError::SafeMode)
                } else if offline {
                    Some(DownloadError::Offline)
                } else {
                    None
                };
                self.models
                    .start(text(params, "id")?, blocked)
                    .map(|()| Value::Null)
                    .map_err(|error| Self::download_error(&error))
            }
            "models.cancel" => {
                self.models.cancel(text(params, "id")?);
                Ok(Value::Null)
            }
            "models.remove" => self
                .models
                .remove(text(params, "id")?)
                .map(|()| Value::Null)
                .map_err(|error| Self::download_error(&error)),
            other => Err(invalid(&format!("There is no method called {other}."), "method")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ext() -> (tempfile::TempDir, Ext) {
        let dir = tempfile::tempdir().unwrap();
        let ext = Ext::new(dir.path());
        (dir, ext)
    }

    fn call(ext: &Ext, method: &str, params: Value) -> Result<Value, IpcError> {
        ext.call(
            &ExtRequest {
                method: method.to_owned(),
                params,
            },
            false,
            false,
        )
    }

    #[test]
    fn the_store_keeps_text_by_name() {
        let (_dir, ext) = ext();
        assert_eq!(
            call(&ext, "store.get", json!({ "name": "words.txt" })).unwrap(),
            Value::Null
        );
        call(
            &ext,
            "store.put",
            json!({ "name": "words.txt", "text": "Ångström\nOpenNote" }),
        )
        .unwrap();
        assert_eq!(
            call(&ext, "store.get", json!({ "name": "words.txt" })).unwrap(),
            json!("Ångström\nOpenNote")
        );
        call(&ext, "store.remove", json!({ "name": "words.txt" })).unwrap();
        assert_eq!(
            call(&ext, "store.get", json!({ "name": "words.txt" })).unwrap(),
            Value::Null
        );
    }

    #[test]
    fn a_name_cannot_leave_the_store() {
        let (_dir, ext) = ext();
        for name in ["../x", "a/b", "a\\b", ".hidden", "", "x y"] {
            let error = call(&ext, "store.get", json!({ "name": name })).unwrap_err();
            assert_eq!(error.code, codes::INVALID, "{name}");
        }
    }

    #[test]
    fn a_vocabulary_fixes_a_mishearing_and_reports_it() {
        let (_dir, ext) = ext();
        let fixed = call(
            &ext,
            "vocabulary.correct",
            json!({ "vocabulary": "Calvin cycle | calvin psyche", "text": "The calvin psyche makes sugar." }),
        )
        .unwrap();
        assert_eq!(fixed["text"], "The Calvin cycle makes sugar.");
        assert_eq!(fixed["changes"][0]["from"], "calvin psyche");
    }

    #[test]
    fn an_unknown_method_is_refused() {
        let (_dir, ext) = ext();
        assert_eq!(call(&ext, "nope", Value::Null).unwrap_err().code, codes::INVALID);
    }

    #[test]
    fn downloads_refuse_to_start_offline_or_in_safe_mode() {
        let (_dir, ext) = ext();
        let request = ExtRequest {
            method: "models.start".to_owned(),
            params: json!({ "id": "speech-base-en" }),
        };
        assert_eq!(ext.call(&request, true, false).unwrap_err().code, "offline");
        assert_eq!(ext.call(&request, false, true).unwrap_err().code, "safeMode");
        let listed = call(&ext, "models.list", Value::Null).unwrap();
        assert_eq!(listed["models"][0]["state"], "notInstalled");
        assert_eq!(listed["offline"], false);
    }
}
