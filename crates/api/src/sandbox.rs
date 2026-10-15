//! The folders the `opennote` tool may read files from and write files to (`--read-root`, `--write-root`; the
//! current folder when not given). Separate roots, so a script that reads notes from one folder can't be talked
//! into writing over another.
//!
//! A path is allowed only when, after following every symbolic link and junction, it is inside a root, compared
//! whole folder name by whole folder name (`C:\work2` is not inside `C:\work`). Network paths (`\\server\share`,
//! and a mapped drive or link that leads to one), device paths (`\\.\`, `\\?\`), Windows device names (`CON`,
//! `NUL`, `COM1`, `LPT1`, also with an extension such as `nul.txt`), and alternate data streams (`file.md:hidden`)
//! are refused on every system. Each refusal says what to change.

use std::{
    fmt,
    path::{Component, Path, PathBuf},
};

/// Why a path isn't allowed, in words a person or an agent can act on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxError {
    pub path: String,
    pub message: String,
}

impl fmt::Display for SandboxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.path, self.message)
    }
}

impl std::error::Error for SandboxError {}

fn refused(path: &Path, message: impl Into<String>) -> SandboxError {
    SandboxError {
        path: shown(path),
        message: message.into(),
    }
}

/// A path as the person typed or would recognise it, without the `\\?\` prefix canonical paths have on Windows.
fn shown(path: &Path) -> String {
    let text = path.display().to_string();
    text.strip_prefix(r"\\?\")
        .filter(|rest| !rest.starts_with("UNC"))
        .map(str::to_owned)
        .unwrap_or(text)
}

/// Whether a file or folder name is one Windows keeps for a device: `CON`, `PRN`, `AUX`, `NUL`, `COM0` to `COM9`,
/// `LPT0` to `LPT9` (also with superscript digits), `CONIN$`, `CONOUT$`, with or without an extension, and with
/// trailing dots or spaces, which Windows drops.
pub fn device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().trim_end_matches([' ', '.']);
    let upper = stem.to_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return true;
    }
    let mut chars = upper.chars();
    let prefix: String = chars.by_ref().take(3).collect();
    let rest: Vec<char> = chars.collect();
    (prefix == "COM" || prefix == "LPT")
        && rest.len() == 1
        && (rest[0].is_ascii_digit() || matches!(rest[0], '\u{b9}' | '\u{b2}' | '\u{b3}'))
}

/// The checks on the path as typed: no network or device path, no device name, no data stream.
fn check_shape(path: &Path) -> Result<(), SandboxError> {
    let text = path.to_string_lossy();
    if text.starts_with(r"\\") || text.starts_with("//") || text.starts_with(r"\/") || text.starts_with(r"/\") {
        return Err(refused(
            path,
            "Network and device paths aren't allowed. Use a folder on this PC.",
        ));
    }
    if text.contains('\0') {
        return Err(refused(path, "The path has a NUL character."));
    }
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => {
                if !matches!(prefix.kind(), std::path::Prefix::Disk(_)) {
                    return Err(refused(
                        path,
                        "Network and device paths aren't allowed. Use a folder on this PC.",
                    ));
                }
            }
            Component::Normal(name) => {
                let name = name.to_string_lossy();
                if device_name(&name) {
                    return Err(refused(
                        path,
                        format!("{name} is a name Windows keeps for a device. Choose another name."),
                    ));
                }
                if name.contains(':') {
                    return Err(refused(path, "A name can't contain a colon."));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Whether a canonical path leads to a network share.
fn is_network(canonical: &Path) -> bool {
    let text = canonical.to_string_lossy();
    text.starts_with(r"\\?\UNC\") || (text.starts_with(r"\\") && !text.starts_with(r"\\?\"))
}

/// The real path: every link followed. For a path that doesn't exist yet, its nearest existing folder's real path
/// with the rest added, where the rest may only be plain names.
fn real_path(path: &Path) -> Result<PathBuf, SandboxError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| refused(path, format!("The current folder can't be read: {error}")))?
            .join(path)
    };
    let mut existing = absolute.clone();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match std::fs::canonicalize(&existing) {
            Ok(real) => {
                let mut real = real;
                for name in rest.iter().rev() {
                    real.push(name);
                }
                if is_network(&real) {
                    return Err(refused(
                        path,
                        "This leads to a network folder. Use a folder on this PC.",
                    ));
                }
                return Ok(real);
            }
            Err(_) => {
                let Some(name) = existing.file_name().map(ToOwned::to_owned) else {
                    return Err(refused(path, "No part of this path exists."));
                };
                if existing.symlink_metadata().is_ok() {
                    // A link whose target is missing: following it later could go anywhere.
                    return Err(refused(path, "This is a link to something that doesn't exist."));
                }
                rest.push(name);
                if !existing.pop() {
                    return Err(refused(path, "No part of this path exists."));
                }
            }
        }
    }
}

fn inside(path: &Path, root: &Path) -> bool {
    let fold = |component: Component<'_>| {
        let text = component.as_os_str().to_string_lossy();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text.into_owned()
        }
    };
    let mut path = path.components().map(fold);
    root.components().map(fold).all(|part| path.next().as_ref() == Some(&part))
}

/// The roots one run of the tool may use.
#[derive(Debug, Clone)]
pub struct Sandbox {
    read: Vec<PathBuf>,
    write: Vec<PathBuf>,
}

impl Sandbox {
    /// Roots that must exist. Each is checked like any path and kept as its real path.
    pub fn new(read: &[PathBuf], write: &[PathBuf]) -> Result<Sandbox, SandboxError> {
        let real = |roots: &[PathBuf]| -> Result<Vec<PathBuf>, SandboxError> {
            roots
                .iter()
                .map(|root| {
                    check_shape(root)?;
                    let real = real_path(root)?;
                    if !real.is_dir() {
                        return Err(refused(root, "A root must be a folder that exists."));
                    }
                    Ok(real)
                })
                .collect()
        };
        Ok(Sandbox {
            read: real(read)?,
            write: real(write)?,
        })
    }

    /// The current folder for both reading and writing.
    pub fn current_folder() -> Result<Sandbox, SandboxError> {
        Sandbox::new(&[PathBuf::from(".")], &[PathBuf::from(".")])
    }

    /// The real path of a file to read, when it is inside a read root.
    pub fn check_read(&self, path: &Path) -> Result<PathBuf, SandboxError> {
        self.check(path, &self.read, "read from", "--read-root")
    }

    /// The real path of a file or folder to write, when it is inside a write root. It needn't exist yet.
    pub fn check_write(&self, path: &Path) -> Result<PathBuf, SandboxError> {
        self.check(path, &self.write, "write to", "--write-root")
    }

    fn check(&self, path: &Path, roots: &[PathBuf], verb: &str, flag: &str) -> Result<PathBuf, SandboxError> {
        check_shape(path)?;
        let real = real_path(path)?;
        if roots.iter().any(|root| inside(&real, root)) {
            return Ok(real);
        }
        let list: Vec<String> = roots.iter().map(|root| shown(root)).collect();
        Err(refused(
            path,
            format!(
                "This is outside the folders this command may {verb} ({}). Pass {flag} with a folder to allow it.",
                if list.is_empty() {
                    "none".to_owned()
                } else {
                    list.join("; ")
                }
            ),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_names_windows_keeps_for_devices() {
        for name in [
            "CON", "con", "nul.txt", "Nul.tar.gz", "COM1", "lpt9", "AUX ", "PRN.", "COM\u{b9}", "CONIN$", "conout$.log",
        ] {
            assert!(device_name(name), "{name}");
        }
        for name in ["CONSOLE", "COM10", "COM", "nullable.md", "my CON.md", "LPTA", "aux_notes"] {
            assert!(!device_name(name), "{name}");
        }
    }

    #[test]
    fn keeps_files_inside_their_roots() {
        let base = tempfile::tempdir().expect("a folder");
        let work = base.path().join("work");
        let work2 = base.path().join("work2");
        let notes = base.path().join("notes");
        for folder in [&work, &work2, &notes] {
            std::fs::create_dir(folder).expect("made");
        }
        std::fs::write(notes.join("in.md"), "x").expect("written");
        let sandbox = Sandbox::new(std::slice::from_ref(&notes), std::slice::from_ref(&work)).expect("roots");
        assert!(sandbox.check_read(&notes.join("in.md")).is_ok());
        assert!(sandbox.check_write(&work.join("new").join("out.md")).is_ok());
        // Reading and writing have separate roots.
        assert!(sandbox.check_write(&notes.join("in.md")).is_err());
        assert!(sandbox.check_read(&work.join("x.md")).is_err());
        // Whole folder names: work2 is not inside work.
        assert!(sandbox.check_write(&work2.join("out.md")).is_err());
        // .. is resolved before the check.
        assert!(sandbox.check_write(&work.join("..").join("work2").join("x.md")).is_err());
        let error = sandbox
            .check_write(&work.join("con.md"))
            .expect_err("a device name");
        assert!(error.message.contains("device"), "{error}");
        assert!(sandbox.check_write(&work.join("a.md:hidden")).is_err());
        assert!(sandbox.check_read(Path::new(r"\\server\share\x.md")).is_err());
        assert!(sandbox.check_read(Path::new(r"\\?\C:\x.md")).is_err());
        assert!(sandbox.check_read(Path::new(r"\\.\PhysicalDrive0")).is_err());
        assert!(sandbox.check_read(Path::new("//server/share/x.md")).is_err());
    }

    #[test]
    fn follows_links_before_it_checks() {
        let base = tempfile::tempdir().expect("a folder");
        let work = base.path().join("work");
        let outside = base.path().join("outside");
        std::fs::create_dir(&work).expect("made");
        std::fs::create_dir(&outside).expect("made");
        let link = work.join("escape");
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&outside, &link).is_ok()
            || std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&outside)
                .output()
                .is_ok_and(|done| done.status.success());
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, &link).is_ok();
        if !made {
            eprintln!("Links can't be made here; skipped.");
            return;
        }
        let sandbox = Sandbox::new(std::slice::from_ref(&work), std::slice::from_ref(&work)).expect("roots");
        let error = sandbox
            .check_write(&link.join("out.md"))
            .expect_err("the link leads outside");
        assert!(error.message.contains("outside"), "{error}");
    }
}
