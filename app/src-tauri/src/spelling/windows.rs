//! The spelling thread over `ISpellCheckerFactory` (ARCHITECTURE.md section 16.2). One thread initializes COM for
//! the multithreaded apartment, creates the factory and one `ISpellChecker` per language on first use, and serves
//! requests from a channel. The service the commands share is a handle to that thread, which starts on the first
//! request.

use std::sync::mpsc;
use std::sync::OnceLock;

use super::MAX_SUGGESTIONS;
use super::{common_errors, merge_suggestions, Rules, SpellError, SpellItem, SpellLanguage, SpellResult};
use crate::ipc::{codes, IpcError, IpcResult};

/// The managed state the spelling commands share: a handle to the spelling thread.
#[derive(Debug, Default, Clone, Copy)]
pub struct SpellService;

type Job = Box<dyn FnOnce(&mut engine::Engine) + Send>;

static WORKER: OnceLock<Option<mpsc::Sender<Job>>> = OnceLock::new();

fn worker() -> IpcResult<&'static mpsc::Sender<Job>> {
    WORKER
        .get_or_init(|| {
            let (sender, jobs) = mpsc::channel::<Job>();
            let spawned = std::thread::Builder::new().name("spelling".into()).spawn(move || {
                let mut engine = engine::Engine::start();
                for job in jobs {
                    job(&mut engine);
                }
            });
            match spawned {
                Ok(_) => Some(sender),
                Err(error) => {
                    log::error!("Couldn't start the spelling thread: {error}");
                    None
                }
            }
        })
        .as_ref()
        .ok_or_else(unavailable)
}

fn unavailable() -> IpcError {
    IpcError::new(codes::INTERNAL, "Spell check isn't available.")
}

impl SpellService {
    /// Runs `job` on the spelling thread and waits for its answer. Call it off the async runtime's threads.
    fn run<T: Send + 'static>(self, job: impl FnOnce(&mut engine::Engine) -> T + Send + 'static) -> IpcResult<T> {
        let (reply, answer) = mpsc::channel();
        worker()?
            .send(Box::new(move |engine| {
                let _ = reply.send(job(engine));
            }))
            .map_err(|_| unavailable())?;
        answer.recv().map_err(|_| unavailable())
    }

    /// The installed spell-checking languages, marking those in the Windows language list as the defaults.
    pub fn languages(self) -> IpcResult<Vec<SpellLanguage>> {
        self.run(|engine| engine.languages())
    }

    /// Each item checked with every enabled language; empty `languages` means the defaults.
    pub fn check(self, items: Vec<SpellItem>, languages: Vec<String>, rules: &Rules) -> IpcResult<Vec<SpellResult>> {
        let rules = rules.clone();
        self.run(move |engine| {
            let tags = engine.resolve(&languages);
            items
                .into_iter()
                .map(|item| {
                    let units: Vec<u16> = item.text.encode_utf16().collect();
                    let per_language: Vec<Vec<SpellError>> =
                        tags.iter().map(|tag| engine.check(tag, &item.text)).collect();
                    SpellResult {
                        id: item.id,
                        errors: rules.filter(&units, common_errors(&per_language)),
                    }
                })
                .collect()
        })
    }

    /// Up to 5 suggestions, merged across the enabled languages that flag the word.
    pub fn suggest(self, word: &str, languages: &[String]) -> IpcResult<Vec<String>> {
        let word = word.to_owned();
        let languages = languages.to_vec();
        self.run(move |engine| {
            let tags = engine.resolve(&languages);
            let lists = tags.iter().map(|tag| engine.suggest(tag, &word)).collect();
            merge_suggestions(lists, MAX_SUGGESTIONS)
        })
    }
}

#[cfg(windows)]
mod engine {
    use std::collections::HashMap;

    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Globalization::{
        GetLocaleInfoEx, GetUserPreferredUILanguages, ISpellChecker, ISpellCheckerFactory, SpellCheckerFactory,
        CORRECTIVE_ACTION_DELETE, CORRECTIVE_ACTION_NONE, LOCALE_SLOCALIZEDDISPLAYNAME, MUI_LANGUAGE_NAME,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, IEnumString, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };

    use crate::spelling::{SpellError, SpellLanguage};

    pub struct Engine {
        factory: Option<ISpellCheckerFactory>,
        checkers: HashMap<String, Option<ISpellChecker>>,
    }

    impl Engine {
        pub fn start() -> Self {
            // SAFETY: called once on the spelling thread, which owns the apartment for its lifetime.
            let factory = unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                CoCreateInstance::<_, ISpellCheckerFactory>(&SpellCheckerFactory, None, CLSCTX_INPROC_SERVER)
            };
            let factory = factory
                .inspect_err(|error| log::warn!("Spell check is off: no spell checker factory ({error})"))
                .ok();
            Self {
                factory,
                checkers: HashMap::new(),
            }
        }

        fn supported(&self) -> Vec<String> {
            let Some(factory) = &self.factory else {
                return Vec::new();
            };
            // SAFETY: the factory lives on this thread; the enumerator's strings are freed by take_strings.
            unsafe {
                factory
                    .SupportedLanguages()
                    .map(|list| take_strings(&list))
                    .unwrap_or_default()
            }
        }

        pub fn languages(&self) -> Vec<SpellLanguage> {
            let supported = self.supported();
            let defaults = default_tags(&supported);
            supported
                .into_iter()
                .map(|tag| SpellLanguage {
                    is_default: defaults.iter().any(|d| d.eq_ignore_ascii_case(&tag)),
                    name: display_name(&tag),
                    tag,
                })
                .collect()
        }

        /// The installed tags among `wanted`, or the defaults when `wanted` is empty.
        pub fn resolve(&self, wanted: &[String]) -> Vec<String> {
            let supported = self.supported();
            if wanted.is_empty() {
                return default_tags(&supported);
            }
            wanted
                .iter()
                .filter_map(|tag| supported.iter().find(|known| known.eq_ignore_ascii_case(tag)).cloned())
                .collect()
        }

        fn checker(&mut self, tag: &str) -> Option<&ISpellChecker> {
            let factory = self.factory.as_ref()?;
            self.checkers
                .entry(tag.to_ascii_lowercase())
                .or_insert_with(|| {
                    // SAFETY: the factory lives on this thread.
                    unsafe { factory.CreateSpellChecker(&HSTRING::from(tag)) }
                        .inspect_err(|error| log::warn!("No spell checker for {tag}: {error}"))
                        .ok()
                })
                .as_ref()
        }

        /// Misspelled words, in UTF-16 units. Repeated words ("the the") aren't spelling errors here.
        pub fn check(&mut self, tag: &str, text: &str) -> Vec<SpellError> {
            let Some(checker) = self.checker(tag) else {
                return Vec::new();
            };
            let mut errors = Vec::new();
            // SAFETY: the checker lives on this thread; each error is a COM object the loop releases.
            unsafe {
                let Ok(found) = checker.Check(&HSTRING::from(text)) else {
                    return errors;
                };
                loop {
                    let mut next = None;
                    if found.Next(&mut next).is_err() {
                        break;
                    }
                    let Some(error) = next else { break };
                    let action = error.CorrectiveAction().unwrap_or(CORRECTIVE_ACTION_NONE);
                    if action == CORRECTIVE_ACTION_DELETE || action == CORRECTIVE_ACTION_NONE {
                        continue;
                    }
                    if let (Ok(start), Ok(length)) = (error.StartIndex(), error.Length()) {
                        errors.push(SpellError { start, length });
                    }
                }
            }
            errors
        }

        /// The checker's suggestions, or none when the word is spelled right in this language.
        pub fn suggest(&mut self, tag: &str, word: &str) -> Vec<String> {
            if self.check(tag, word).is_empty() {
                return Vec::new();
            }
            let Some(checker) = self.checker(tag) else {
                return Vec::new();
            };
            // SAFETY: as in check.
            unsafe {
                checker
                    .Suggest(&HSTRING::from(word))
                    .map(|list| take_strings(&list))
                    .unwrap_or_default()
            }
        }
    }

    /// Reads an enumerator of task-allocated strings, freeing each.
    unsafe fn take_strings(list: &IEnumString) -> Vec<String> {
        let mut out = Vec::new();
        loop {
            let mut item = [PWSTR::null()];
            let mut fetched = 0u32;
            // SAFETY: one slot, filled with a CoTaskMemAlloc string the loop frees.
            let result = unsafe { list.Next(&mut item, Some(&mut fetched)) };
            if result.is_err() || fetched == 0 || item[0].is_null() {
                break;
            }
            // SAFETY: the string is valid until it's freed just below.
            unsafe {
                if let Ok(text) = item[0].to_string() {
                    out.push(text);
                }
                CoTaskMemFree(Some(item[0].0 as *const _));
            }
        }
        out
    }

    /// The installed tags that match the Windows language list, matching a neutral language to its first region.
    fn default_tags(supported: &[String]) -> Vec<String> {
        let mut tags: Vec<String> = Vec::new();
        for preferred in preferred_languages() {
            let exact = supported.iter().find(|tag| tag.eq_ignore_ascii_case(&preferred));
            let primary = preferred.split('-').next().unwrap_or_default().to_ascii_lowercase();
            let near = || {
                supported
                    .iter()
                    .find(|tag| tag.split('-').next().unwrap_or_default().eq_ignore_ascii_case(&primary))
            };
            if let Some(tag) = exact.or_else(near) {
                if !tags.contains(tag) {
                    tags.push(tag.clone());
                }
            }
        }
        tags
    }

    fn preferred_languages() -> Vec<String> {
        let mut count = 0u32;
        let mut length = 0u32;
        // SAFETY: the first call sizes the buffer, the second fills it with a double-null-terminated list.
        unsafe {
            if GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, None, &mut length).is_err() {
                return Vec::new();
            }
            let mut buffer = vec![0u16; length as usize];
            let filled = GetUserPreferredUILanguages(
                MUI_LANGUAGE_NAME,
                &mut count,
                Some(PWSTR(buffer.as_mut_ptr())),
                &mut length,
            );
            if filled.is_err() {
                return Vec::new();
            }
            buffer
                .split(|unit| *unit == 0)
                .filter(|part| !part.is_empty())
                .map(String::from_utf16_lossy)
                .collect()
        }
    }

    fn display_name(tag: &str) -> String {
        let mut buffer = [0u16; 256];
        // SAFETY: the buffer's length bounds the write.
        let written = unsafe { GetLocaleInfoEx(&HSTRING::from(tag), LOCALE_SLOCALIZEDDISPLAYNAME, Some(&mut buffer)) };
        if written <= 1 {
            return tag.to_owned();
        }
        String::from_utf16_lossy(&buffer[..written as usize - 1])
    }
}

#[cfg(not(windows))]
mod engine {
    use crate::spelling::{SpellError, SpellLanguage};

    /// Other systems have no spell checker yet: every word passes.
    pub struct Engine;

    impl Engine {
        pub fn start() -> Self {
            Self
        }
        pub fn languages(&self) -> Vec<SpellLanguage> {
            Vec::new()
        }
        pub fn resolve(&self, _wanted: &[String]) -> Vec<String> {
            Vec::new()
        }
        pub fn check(&mut self, _tag: &str, _text: &str) -> Vec<SpellError> {
            Vec::new()
        }
        pub fn suggest(&mut self, _tag: &str, _word: &str) -> Vec<String> {
            Vec::new()
        }
    }
}
