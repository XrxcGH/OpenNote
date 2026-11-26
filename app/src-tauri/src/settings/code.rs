//! The `code` settings group (Beta 12): personal preferences of the code studio and of code cells (code program
//! DESIGN section 5.6). It was added with defaults, so the schema version stays 2. Toolchain paths, tier 2
//! consents, and installed packs are device state, not settings (ADR 0013). Lane code:L04 builds the Settings,
//! then Code page on these keys.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::validate::Check;

/// The code editor's preferences. Every field has a default, so a file without the group loads unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CodeSettings {
    /// Indent choices by language id (`python`, `javascript`, `go`, and so on), for the languages a person
    /// changed only. Every other language uses [`default_indent`].
    pub indent: BTreeMap<String, CodeIndent>,
    pub python_runtime: PythonRuntime,
    /// The default run time limit, in seconds.
    pub time_limit_seconds: u16,
    /// The default run memory limit, in MiB.
    pub memory_limit_mib: u16,
    pub format_on_save: bool,
    /// Whether the completion list opens as a person types.
    pub completion_list: bool,
    pub suggestions: CodeSuggestions,
    pub accept_button: AcceptButton,
    /// Whether a screen reader hears each new suggestion.
    pub announce_suggestions: bool,
    pub diagnostics: DiagnosticsLevel,
    pub c_standard: CStandard,
    pub cpp_standard: CppStandard,
    /// Whether C and C++ compile with `-Wall -Wextra`.
    pub compiler_warnings: bool,
}

impl Default for CodeSettings {
    fn default() -> Self {
        Self {
            indent: BTreeMap::new(),
            python_runtime: PythonRuntime::Quick,
            time_limit_seconds: 10,
            memory_limit_mib: 64,
            format_on_save: false,
            completion_list: true,
            suggestions: CodeSuggestions::AutomaticRules,
            accept_button: AcceptButton::TouchOrPen,
            announce_suggestions: true,
            diagnostics: DiagnosticsLevel::Everything,
            c_standard: CStandard::C17,
            cpp_standard: CppStandard::Cpp20,
            compiler_warnings: true,
        }
    }
}

/// How one language indents: the width of one indent stop and whether Tab inserts spaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct CodeIndent {
    pub tab_size: u8,
    pub insert_spaces: bool,
}

/// The Python runtime a new project uses: quick (MicroPython, bundled) or full (Pyodide, a pack).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum PythonRuntime {
    #[default]
    Quick,
    Full,
}

/// When ghost text suggestions show. `AutomaticModel` needs a code model (R2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum CodeSuggestions {
    Off,
    OnRequest,
    #[default]
    AutomaticRules,
    AutomaticModel,
}

/// When a shown suggestion gets an Accept button.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum AcceptButton {
    #[default]
    TouchOrPen,
    Always,
    Never,
}

/// Which diagnostics the editor marks: errors, errors and warnings, or everything including hints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum DiagnosticsLevel {
    Errors,
    Warnings,
    #[default]
    Everything,
}

/// The C language standard, as clang's `-std=` names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum CStandard {
    C99,
    C11,
    #[default]
    C17,
    C23,
}

/// The C++ language standard, as clang's `-std=` names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum CppStandard {
    Cpp14,
    Cpp17,
    #[default]
    Cpp20,
    Cpp23,
}

impl CStandard {
    /// The value of clang's `-std=` option.
    pub fn flag(self) -> &'static str {
        match self {
            Self::C99 => "c99",
            Self::C11 => "c11",
            Self::C17 => "c17",
            Self::C23 => "c23",
        }
    }
}

impl CppStandard {
    /// The value of clang's `-std=` option.
    pub fn flag(self) -> &'static str {
        match self {
            Self::Cpp14 => "c++14",
            Self::Cpp17 => "c++17",
            Self::Cpp20 => "c++20",
            Self::Cpp23 => "c++23",
        }
    }
}

/// Languages whose files must indent with a tab character, whatever the spaces setting: Go (gofmt) and
/// Makefiles (make needs a tab before each recipe line).
const TAB_LANGUAGES: [&str; 2] = ["go", "makefile"];

/// Languages that indent by 2 spaces by default. Every other language uses 4 (code DESIGN section 5.3.1).
const TWO_SPACE_LANGUAGES: [&str; 7] = ["javascript", "typescript", "sql", "lua", "ruby", "r", "dart"];

/// Whether a key of `code.indent` is a language id, such as `python`, `cpp`, or `objective-c`. An id has 1 to
/// 24 lowercase ASCII letters, digits, and inner hyphens, and starts with a letter. The web settings client
/// checks the same rule. So does the code studio's language list.
pub fn is_language_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (1..=24).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes[bytes.len() - 1] != b'-'
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// The indent a language uses when a person has not changed it.
pub fn default_indent(language: &str) -> CodeIndent {
    let tab_size = if TWO_SPACE_LANGUAGES.contains(&language) { 2 } else { 4 };
    CodeIndent {
        tab_size,
        insert_spaces: !TAB_LANGUAGES.contains(&language),
    }
}

impl CodeSettings {
    /// The longest time limit and the largest memory limit a tier 1 run may have.
    pub const TIME_LIMIT_RANGE: (u16, u16) = (1, 60);
    pub const MEMORY_LIMIT_RANGE: (u16, u16) = (16, 256);
    /// The most languages with their own indent choice.
    pub const MAX_INDENT_LANGUAGES: usize = 64;

    /// The indent a language uses: the person's choice or the default. Tab languages always insert tabs.
    pub fn indent_for(&self, language: &str) -> CodeIndent {
        let mut indent = self
            .indent
            .get(language)
            .copied()
            .unwrap_or_else(|| default_indent(language));
        if TAB_LANGUAGES.contains(&language) {
            indent.insert_spaces = false;
        }
        indent
    }

    pub fn check(&self, check: &mut Check) {
        let ids_ok = self.indent.len() <= Self::MAX_INDENT_LANGUAGES && self.indent.keys().all(|id| is_language_id(id));
        check.that("code.indent", ids_ok, "A language id isn't a short lowercase name.");
        let sizes_ok = self.indent.values().all(|indent| (1..=8).contains(&indent.tab_size));
        check.that("code.indent", sizes_ok, "A tab size is outside 1 to 8.");
        let (min, max) = Self::TIME_LIMIT_RANGE;
        check.that(
            "code.timeLimitSeconds",
            (min..=max).contains(&self.time_limit_seconds),
            "The time limit is outside 1 to 60 seconds.",
        );
        let (min, max) = Self::MEMORY_LIMIT_RANGE;
        check.that(
            "code.memoryLimitMib",
            (min..=max).contains(&self.memory_limit_mib),
            "The memory limit is outside 16 to 256 MiB.",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checked(settings: &CodeSettings) -> Option<String> {
        let mut check = Check::default();
        settings.check(&mut check);
        check.finish().err().and_then(|error| error.field)
    }

    /// Known answers from the code program's DESIGN section 5.3.1 and 5.6, not from this code.
    #[test]
    fn defaults_follow_the_design() {
        let settings = CodeSettings::default();
        assert_eq!((settings.time_limit_seconds, settings.memory_limit_mib), (10, 64));
        let spaces = |tab_size| CodeIndent {
            tab_size,
            insert_spaces: true,
        };
        assert_eq!(settings.indent_for("python"), spaces(4), "PEP 8");
        assert_eq!(settings.indent_for("javascript"), spaces(2));
        assert_eq!(settings.indent_for("typescript"), spaces(2));
        for four in [
            "c",
            "cpp",
            "java",
            "csharp",
            "kotlin",
            "swift",
            "rust",
            "php",
            "powershell",
        ] {
            assert_eq!(settings.indent_for(four), spaces(4), "{four}");
        }
        for two in ["sql", "lua", "ruby", "r", "dart"] {
            assert_eq!(settings.indent_for(two), spaces(2), "{two}");
        }
        assert!(!settings.indent_for("go").insert_spaces, "gofmt indents with tabs");
        assert!(!settings.indent_for("makefile").insert_spaces, "make needs a tab");
        assert_eq!(
            (settings.c_standard.flag(), settings.cpp_standard.flag()),
            ("c17", "c++20")
        );
    }

    #[test]
    fn a_person_s_indent_wins_except_that_tab_languages_keep_tabs() {
        let mut settings = CodeSettings::default();
        let eight = CodeIndent {
            tab_size: 8,
            insert_spaces: true,
        };
        settings.indent.insert("python".into(), eight);
        settings.indent.insert("go".into(), eight);
        assert_eq!(settings.indent_for("python"), eight);
        assert_eq!(
            settings.indent_for("go"),
            CodeIndent {
                tab_size: 8,
                insert_spaces: false
            }
        );
    }

    #[test]
    fn checks_limits_tab_sizes_and_language_ids() {
        let mut settings = CodeSettings::default();
        assert_eq!(checked(&settings), None);
        settings.time_limit_seconds = 61;
        assert_eq!(checked(&settings).as_deref(), Some("code.timeLimitSeconds"));
        settings.time_limit_seconds = 60;
        settings.memory_limit_mib = 512;
        assert_eq!(checked(&settings).as_deref(), Some("code.memoryLimitMib"));
        settings.memory_limit_mib = 256;
        assert_eq!(checked(&settings), None);
        let zero = CodeIndent {
            tab_size: 0,
            insert_spaces: true,
        };
        settings.indent.insert("python".into(), zero);
        assert_eq!(checked(&settings).as_deref(), Some("code.indent"));
        settings.indent.clear();
        settings.indent.insert("C++".into(), default_indent("cpp"));
        assert_eq!(checked(&settings).as_deref(), Some("code.indent"));
    }

    #[test]
    fn language_ids_are_short_lowercase_names_with_inner_hyphens() {
        for id in [
            "python",
            "cpp",
            "c",
            "objective-c",
            "x86-64",
            "abcdefghijklmnopqrstuvwx",
        ] {
            assert!(is_language_id(id), "{id}");
        }
        for id in [
            "",
            "C++",
            "Python",
            "-c",
            "c-",
            "1c",
            "c sharp",
            "abcdefghijklmnopqrstuvwxy",
        ] {
            assert!(!is_language_id(id), "{id}");
        }
        let mut settings = CodeSettings::default();
        settings
            .indent
            .insert("objective-c".into(), default_indent("objective-c"));
        assert_eq!(checked(&settings), None);
    }

    #[test]
    fn serializes_in_camel_case() {
        let value = serde_json::to_value(CodeSettings::default()).expect("serializes");
        assert_eq!(value["suggestions"], "automaticRules");
        assert_eq!(value["acceptButton"], "touchOrPen");
        assert_eq!(value["cStandard"], "c17");
        assert_eq!(value["cppStandard"], "cpp20");
        assert_eq!(value["pythonRuntime"], "quick");
    }
}
