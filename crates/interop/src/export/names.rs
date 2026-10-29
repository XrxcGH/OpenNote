//! File and folder names for exports: safe on Windows, and unique within a folder.

use std::collections::HashSet;

/// The longest name, in characters, before the extension.
const MAX_NAME_CHARS: usize = 100;

/// Turns a title into a file or folder name that Windows, macOS, and Linux accept.
pub fn sanitize_name(title: &str, fallback: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => ' ',
            c => c,
        })
        .take(MAX_NAME_CHARS)
        .collect();
    let trimmed = cleaned.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        return fallback.to_owned();
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed).to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.ends_with(|c: char| c.is_ascii_digit()));
    if reserved {
        format!("{trimmed}_")
    } else {
        trimmed.to_owned()
    }
}

/// Hands out names that no other name in the same folder has, ignoring case.
#[derive(Debug, Default)]
pub struct Namer {
    used: HashSet<String>,
}

impl Namer {
    /// `name.ext`, or `name (2).ext`, `name (3).ext`, and so on when the name is taken.
    pub fn unique(&mut self, name: &str, extension: &str) -> String {
        let suffix = if extension.is_empty() {
            String::new()
        } else {
            format!(".{extension}")
        };
        let mut candidate = format!("{name}{suffix}");
        let mut n = 2;
        while !self.used.insert(candidate.to_lowercase()) {
            candidate = format!("{name} ({n}){suffix}");
            n += 1;
        }
        candidate
    }
}

/// The path from a folder to a file, with `/` separators, where both are given as parts below the same root.
pub fn relative_path(from_dir: &[String], to: &[String]) -> String {
    let common = from_dir.iter().zip(to).take_while(|(a, b)| a == b).count();
    let mut parts: Vec<&str> = vec![".."; from_dir.len() - common];
    parts.extend(to[common..].iter().map(String::as_str));
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(path: &str) -> Vec<String> {
        path.split('/').filter(|p| !p.is_empty()).map(str::to_owned).collect()
    }

    #[test]
    fn names_are_safe_and_unique() {
        assert_eq!(sanitize_name("Lab: day 1/2?", "Untitled"), "Lab- day 1-2-");
        assert_eq!(sanitize_name("  ...  ", "Untitled"), "Untitled");
        assert_eq!(sanitize_name("con", "Untitled"), "con_");
        let mut namer = Namer::default();
        assert_eq!(namer.unique("Notes", "md"), "Notes.md");
        assert_eq!(namer.unique("notes", "md"), "notes (2).md");
        assert_eq!(namer.unique("Notes", "md"), "Notes (3).md");
    }

    #[test]
    fn relative_paths_climb_out_of_folders() {
        assert_eq!(
            relative_path(&parts("Biology/Lab"), &parts("assets/leaf.png")),
            "../../assets/leaf.png"
        );
        assert_eq!(relative_path(&parts("Biology"), &parts("Biology/Cells.md")), "Cells.md");
        assert_eq!(relative_path(&[], &parts("assets/a.png")), "assets/a.png");
    }
}
