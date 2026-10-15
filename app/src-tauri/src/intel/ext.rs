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

use super::cloud::{Cloud, CloudError, CloudFeature};
use super::llm::{Llm, LlmError};
use super::models::{self, DownloadError, Models};
use super::native::{self, Native, NativeError};
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
    cloud: Cloud,
    llm: Llm,
    native: std::sync::Arc<Native>,
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
        let cloud = Cloud::new(
            &device.join("intel"),
            crate::connectors::platform_store(),
            std::sync::Arc::new(crate::connectors::UreqHttp::default()),
        );
        Ext::with_parts(device, models, cloud)
    }

    pub fn with_parts(device: &Path, models: Models, cloud: Cloud) -> Ext {
        Ext {
            store: device.join("intel"),
            models,
            cloud,
            llm: Llm::new(&device.join("engines")),
            native: std::sync::Arc::new(Native::default()),
        }
    }

    /// The cloud calls, which the transcription command shares.
    pub fn cloud(&self) -> &Cloud {
        &self.cloud
    }

    fn cloud_error(error: &CloudError) -> IpcError {
        IpcError::new(error.code(), error.message())
    }

    fn cloud_feature(params: &Value) -> Result<CloudFeature, IpcError> {
        CloudFeature::parse(text(params, "feature")?)
            .ok_or_else(|| invalid("That feature can't use a cloud key.", "feature"))
    }

    /// Replaces the language model program, so a test can use a stand-in.
    #[cfg(test)]
    pub fn with_llm(mut self, llm: Llm) -> Ext {
        self.llm = llm;
        self
    }

    fn llm_error(error: &LlmError) -> IpcError {
        IpcError::new(error.code(), error.message())
    }

    fn native_error(error: &NativeError) -> IpcError {
        IpcError::new(error.code(), error.message())
    }

    /// The language model the person picked, or the best one that is installed.
    fn language_model(&self) -> Option<PathBuf> {
        let chosen = fs::read_to_string(self.store.join("language-model.txt")).unwrap_or_default();
        let found = [chosen.trim(), "language-balanced", "language-small"]
            .into_iter()
            .filter(|id| models::spec_of(id).is_some_and(|spec| spec.kind == "language"))
            .find_map(|id| self.models.installed_path(id));
        found
    }

    fn strings(params: &Value, key: &str) -> Result<Vec<String>, IpcError> {
        params
            .get(key)
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("A list of texts is missing.", key))?
            .iter()
            .map(|one| {
                one.as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| invalid("A text is not text.", key))
            })
            .collect()
    }

    /// The folder of an installed pack: its files are beside its first one.
    fn pack_dir(&self, id: &str, missing: &str) -> Result<PathBuf, IpcError> {
        let main = self
            .models
            .installed_path(id)
            .ok_or_else(|| IpcError::new("model", missing))?;
        Ok(main
            .parent()
            .map_or_else(|| self.models.dir().to_path_buf(), Path::to_path_buf))
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
        let (method, params) = (request.method.as_str(), &request.params);
        match method.split('.').next().unwrap_or_default() {
            "store" | "vocabulary" => self.call_device(method, params),
            "models" => self.call_models(method, params, offline, safe_mode),
            "engines" | "llm" | "translate" | "embed" => self.call_engines(method, params, safe_mode),
            "cloud" => self.call_cloud(method, params, offline, safe_mode),
            _ => Err(invalid(&format!("There is no method called {method}."), "method")),
        }
    }

    /// The small store and the vocabulary.
    fn call_device(&self, method: &str, params: &Value) -> Result<Value, IpcError> {
        match method {
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
            "store.list" => {
                let prefix = text(params, "prefix")?;
                if !prefix.is_empty() {
                    store_name(prefix)?;
                }
                let entries = match fs::read_dir(&self.store) {
                    Ok(entries) => entries,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(json!([])),
                    Err(error) => return Err(io_error(&error)),
                };
                let mut names: Vec<String> = entries
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
                    .filter_map(|entry| entry.file_name().into_string().ok())
                    .filter(|name| name.starts_with(prefix) && store_name(name).is_ok())
                    .collect();
                names.sort();
                Ok(json!(names))
            }
            "vocabulary.correct" => {
                let request: opennote_intel::wire::VocabularyCorrectRequest =
                    serde_json::from_value(params.clone()).map_err(|error| invalid(&error.to_string(), "params"))?;
                serde_json::to_value(request.correct())
                    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
            }
            other => Err(invalid(&format!("There is no method called {other}."), "method")),
        }
    }

    /// Model downloads.
    fn call_models(&self, method: &str, params: &Value, offline: bool, safe_mode: bool) -> Result<Value, IpcError> {
        match method {
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
            "models.remove" => {
                // Let go of the loaded models first, so their files can be deleted.
                self.native.unload();
                self.llm.stop();
                self.models
                    .remove(text(params, "id")?)
                    .map(|()| Value::Null)
                    .map_err(|error| Self::download_error(&error))
            }
            other => Err(invalid(&format!("There is no method called {other}."), "method")),
        }
    }

    /// The language model, translation, and meaning vectors.
    fn call_engines(&self, method: &str, params: &Value, safe_mode: bool) -> Result<Value, IpcError> {
        match method {
            "engines.info" => {
                let mut info = native::capabilities();
                info["llmHost"] = json!(self.llm.has_host());
                info["languageModel"] = json!(self.language_model().is_some());
                Ok(info)
            }
            "llm.generate" => {
                if safe_mode {
                    return Err(IpcError::new(DownloadError::SafeMode.code(), "Safe mode is on."));
                }
                let model = self
                    .language_model()
                    .ok_or_else(|| IpcError::new("model", "No language model is downloaded."))?;
                let number = |key: &str, default: f64| params.get(key).and_then(Value::as_f64).unwrap_or(default);
                self.llm
                    .generate(
                        &model,
                        text(params, "system")?,
                        text(params, "prompt")?,
                        number("maxTokens", 400.0).clamp(1.0, 1024.0) as u32,
                        number("temperature", 0.2).clamp(0.0, 1.0) as f32,
                    )
                    .map(|answer| json!({ "text": answer }))
                    .map_err(|error| Self::llm_error(&error))
            }
            "llm.stop" => {
                self.llm.stop();
                Ok(Value::Null)
            }
            "translate.run" => {
                if safe_mode {
                    return Err(IpcError::new(DownloadError::SafeMode.code(), "Safe mode is on."));
                }
                let id = format!("translate-{}", text(params, "pack")?);
                if !models::spec_of(&id).is_some_and(|spec| spec.kind == "translate") {
                    return Err(invalid("That language pack is not offered.", "pack"));
                }
                let lines = Self::strings(params, "lines")?;
                let dir = self.pack_dir(&id, "That language pack is not downloaded.")?;
                self.native
                    .translate(&id, &dir, &lines)
                    .map(|lines| json!({ "lines": lines }))
                    .map_err(|error| Self::native_error(&error))
            }
            "embed.run" => {
                if safe_mode {
                    return Err(IpcError::new(DownloadError::SafeMode.code(), "Safe mode is on."));
                }
                let texts = Self::strings(params, "texts")?;
                let dir = self.pack_dir("meaning-minilm", "The meaning model is not downloaded.")?;
                self.native
                    .embed(&dir, &texts)
                    .map(|vectors| json!({ "vectors": vectors }))
                    .map_err(|error| Self::native_error(&error))
            }
            other => Err(invalid(&format!("There is no method called {other}."), "method")),
        }
    }

    /// The person's own cloud key.
    fn call_cloud(&self, method: &str, params: &Value, offline: bool, safe_mode: bool) -> Result<Value, IpcError> {
        match method {
            "cloud.status" => serde_json::to_value(self.cloud.status())
                .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string())),
            "cloud.setKey" => {
                let feature = Ext::cloud_feature(params)?;
                self.cloud
                    .set_key(feature, text(params, "key")?)
                    .map(|()| Value::Null)
                    .map_err(|error| Ext::cloud_error(&error))
            }
            "cloud.forget" => self
                .cloud
                .forget(Ext::cloud_feature(params)?)
                .map(|()| Value::Null)
                .map_err(|error| Ext::cloud_error(&error)),
            "cloud.summarize" => self
                .cloud
                .summarize(text(params, "text")?, offline, safe_mode)
                .map(|summary| json!({ "summary": summary }))
                .map_err(|error| Ext::cloud_error(&error)),
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
    fn the_store_lists_the_names_that_start_with_a_prefix() {
        let (_dir, ext) = ext();
        assert_eq!(call(&ext, "store.list", json!({ "prefix": "study.deck." })).unwrap(), json!([]));
        for name in ["study.deck.b.json", "study.deck.a.json", "study.states.a.json"] {
            call(&ext, "store.put", json!({ "name": name, "text": "{}" })).unwrap();
        }
        assert_eq!(
            call(&ext, "store.list", json!({ "prefix": "study.deck." })).unwrap(),
            json!(["study.deck.a.json", "study.deck.b.json"])
        );
        let error = call(&ext, "store.list", json!({ "prefix": "../" })).unwrap_err();
        assert_eq!(error.code, codes::INVALID);
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

    fn safe(ext: &Ext, method: &str, params: Value) -> Result<Value, IpcError> {
        let request = ExtRequest {
            method: method.to_owned(),
            params,
        };
        ext.call(&request, false, true)
    }

    #[test]
    fn the_engines_say_what_this_build_and_install_carry() {
        let (_dir, ext) = ext();
        let info = call(&ext, "engines.info", Value::Null).unwrap();
        assert_eq!(info["languageModel"], false);
        assert!(info["onnx"].is_boolean() && info["whisperCpp"].is_boolean() && info["llmHost"].is_boolean());
    }

    #[test]
    fn the_language_model_and_the_packs_need_a_download_and_refuse_in_safe_mode() {
        let (_dir, ext) = ext();
        let write = json!({ "system": "s", "prompt": "p" });
        assert_eq!(call(&ext, "llm.generate", write.clone()).unwrap_err().code, "model");
        assert_eq!(safe(&ext, "llm.generate", write).unwrap_err().code, "safeMode");
        let translate = json!({ "pack": "en-es", "lines": ["hello"] });
        assert_eq!(
            call(&ext, "translate.run", translate.clone()).unwrap_err().code,
            "model"
        );
        assert_eq!(safe(&ext, "translate.run", translate).unwrap_err().code, "safeMode");
        let unknown = json!({ "pack": "xx-yy", "lines": [] });
        assert_eq!(call(&ext, "translate.run", unknown).unwrap_err().code, codes::INVALID);
        let embed = json!({ "texts": ["hello"] });
        assert_eq!(call(&ext, "embed.run", embed.clone()).unwrap_err().code, "model");
        assert_eq!(safe(&ext, "embed.run", embed).unwrap_err().code, "safeMode");
        assert_eq!(
            call(&ext, "translate.run", json!({ "pack": "en-es", "lines": [1] }))
                .unwrap_err()
                .code,
            codes::INVALID
        );
    }

    #[test]
    fn an_installed_language_model_is_found_and_asked_through_the_program() {
        let (dir, ext) = ext();
        let spec = models::spec_of("language-small").unwrap();
        let path = dir.path().join("models").join(spec.main().file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::File::create(&path).unwrap().set_len(spec.size()).unwrap();
        assert_eq!(call(&ext, "engines.info", Value::Null).unwrap()["languageModel"], true);
        // No program is in a test install, so the model is found and the missing program is what fails.
        let ext = ext.with_llm(Llm::with_host(None));
        let error = call(&ext, "llm.generate", json!({ "system": "s", "prompt": "p" })).unwrap_err();
        assert_eq!(error.code, "unavailable");
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
