//! Names for unpacked files that Windows can create, whatever the archive was made on.

use std::path::{Component, Path, PathBuf};

/// Windows device names, compared without case with the part of a name before its first `.`.
const RESERVED: [&str; 32] = [
    "con", "prn", "aux", "nul", "conin$", "conout$", "com0", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
    "com8", "com9", "com¹", "com²", "com³", "lpt0", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8",
    "lpt9", "lpt¹", "lpt²", "lpt³",
];

/// The path an entry unpacks to, or `None` when its name climbs out of `dir` or names nothing.
///
/// Both `/` and `\` separate folders, as tools on Windows write either. Each part is cleaned by
/// [`clean_component`], so a name made on a Mac, such as `What is a cell?.md`, still unpacks. A leading `/` is
/// dropped, so an absolute name lands inside `dir`.
pub(super) fn safe_target(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut target = dir.to_path_buf();
    for part in name.split(['/', '\\']) {
        match part {
            "" | "." => continue,
            ".." => return None,
            _ => {}
        }
        let part = clean_component(part);
        let mut components = Path::new(&part).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(_)), None) => target.push(part),
            _ => return None,
        }
    }
    (target != dir).then_some(target)
}

/// A folder or file name that Windows can create. The characters `< > : " | ? *` and control characters become
/// `_`, trailing dots and spaces go, and a device name such as `CON` or `com1.txt` gets `_` after its stem. A
/// name with nothing left becomes `_`.
pub(super) fn clean_component(part: &str) -> String {
    let replaced: String = part
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = replaced.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        return "_".to_owned();
    }
    let stem_end = trimmed.find('.').unwrap_or(trimmed.len());
    let (stem, rest) = trimmed.split_at(stem_end);
    let bare = stem.trim_end_matches(' ');
    if RESERVED.contains(&bare.to_lowercase().as_str()) {
        let spaces = stem.get(bare.len()..).unwrap_or("");
        format!("{bare}_{spaces}{rest}")
    } else {
        trimmed.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_windows_refuses_are_cleaned() {
        for (name, clean) in [
            ("What is a cell?.md", "What is a cell_.md"),
            ("a:b|c*d<e>f\"g.md", "a_b_c_d_e_f_g.md"),
            ("trailing. . ", "trailing"),
            ("CON", "CON_"),
            ("nul.txt", "nul_.txt"),
            ("Com1 .md", "Com1_ .md"),
            ("console.md", "console.md"),
            ("tab\there.md", "tab_here.md"),
            ("...", "_"),
        ] {
            assert_eq!(clean_component(name), clean, "{name:?}");
        }
    }

    #[test]
    fn targets_stay_inside_the_folder() {
        let dir = Path::new("base");
        assert_eq!(safe_target(dir, "a/b.md"), Some(dir.join("a").join("b.md")));
        assert_eq!(safe_target(dir, "a\\b.md"), Some(dir.join("a").join("b.md")));
        assert_eq!(safe_target(dir, "/abs.md"), Some(dir.join("abs.md")));
        assert_eq!(safe_target(dir, "c:/drive.md"), Some(dir.join("c_").join("drive.md")));
        assert_eq!(safe_target(dir, "a/../../evil.md"), None);
        assert_eq!(safe_target(dir, "a\\..\\evil.md"), None);
        assert_eq!(safe_target(dir, "./"), None);
    }
}
