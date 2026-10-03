//! M6: renames by handle with POSIX semantics while another process holds the target, with and without delete
//! sharing, and flushes of a folder handle (plan 2). The results are compared with the table in spec 17.5.
//!
//! Another process holds the file: this program, run as `opennote-crashtest hold <file> --share <r|rw|rwd>`.
//! It opens the file, says `HELD`, and after a line on its standard input reads the file through the same
//! handle and prints what it saw.

use std::io::{BufRead, BufReader, Read, Seek, Write};
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};

use opennote_core::store::fs::Fs;
use opennote_core::store::std_fs::StdFs;
use opennote_core::FsError;

use super::Ctx;
use crate::opts::Options;

/// Runs M6 in `ctx.dir`.
pub fn run(ctx: &mut Ctx) -> Result<(), String> {
    println!("M6: renames and folder flushes in {}", ctx.dir.display());
    let dir = ctx.scratch("m6")?;
    let fs = StdFs {
        busy_retries: Vec::new(),
    };
    let probe = fs.probe(&dir).map_err(|e| e.to_string())?;
    let label = ctx.label.clone();
    ctx.note(format!(
        "{label}: volume {:?}, remote {}",
        probe.volume.kind, probe.volume.remote
    ));
    ctx.note(format!("{label}: a durable write renames with {:?}", probe.method));
    ctx.note(format!(
        "{label}: flushing a folder handle: {}",
        outcome(&probe.flush_folder)
    ));
    flag(
        ctx,
        "probe.posix_by_handle",
        format!("{:?}", probe.method) == "PosixByHandle",
    );
    flag(ctx, "probe.flush_folder_ok", probe.flush_folder.is_ok());
    for share in ["rwd", "rw"] {
        held(ctx, &fs, &dir.join(format!("held-{share}")), share)?;
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

fn flag(ctx: &mut Ctx, name: &str, value: bool) {
    let full = format!("{}.m6.{name}", ctx.label);
    ctx.report.add(&full, "bool", f64::from(u8::from(value)), None);
}

fn outcome<T: std::fmt::Debug>(result: &Result<T, FsError>) -> String {
    match result {
        Ok(value) => format!("ok {value:?}"),
        Err(err) => format!("{:?} (os error {:?})", err.kind, err.os_code),
    }
}

/// Replacing, deleting, renaming the folder of, and deleting the folder of a file another process holds.
fn held(ctx: &mut Ctx, fs: &StdFs, folder: &Path, share: &str) -> Result<(), String> {
    std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let target = folder.join("page.json");
    std::fs::write(&target, b"old").map_err(|e| e.to_string())?;
    let mut holder = Holder::start(&target, share)?;
    let replaced = fs.replace_durable(&target, b"new");
    let seen = holder.read()?;
    let label = ctx.label.clone();
    ctx.note(format!(
        "{label}: replace while held ({share}): {}; holder read {seen:?}",
        outcome(&replaced)
    ));
    flag(ctx, &format!("held_{share}.replace_ok"), replaced.is_ok());
    flag(ctx, &format!("held_{share}.holder_kept_old"), seen == "old");

    let other = folder.join("other.json");
    std::fs::write(&other, b"x").map_err(|e| e.to_string())?;
    let mut holder = Holder::start(&other, share)?;
    // The folder first: after a delete with POSIX semantics, the held file has no name in the folder any more.
    let renamed = fs.rename_dir(folder, &folder.with_extension("moved"));
    let moved = if renamed.is_ok() {
        folder.with_extension("moved")
    } else {
        folder.to_path_buf()
    };
    let removed = fs.remove_file(&moved.join("other.json"));
    let _ = holder.read();
    ctx.note(format!("{label}: delete while held ({share}): {}", outcome(&removed)));
    ctx.note(format!(
        "{label}: rename the folder while held ({share}): {}",
        outcome(&renamed)
    ));
    flag(ctx, &format!("held_{share}.remove_ok"), removed.is_ok());
    flag(ctx, &format!("held_{share}.rename_folder_ok"), renamed.is_ok());

    let folder = moved;
    let inner = folder.join("inner.json");
    std::fs::write(&inner, b"y").map_err(|e| e.to_string())?;
    let mut holder = Holder::start(&inner, share)?;
    let deleted = fs.remove_dir_all(&folder);
    let _ = holder.read();
    ctx.note(format!(
        "{label}: delete the folder while held ({share}): {}",
        outcome(&deleted)
    ));
    flag(ctx, &format!("held_{share}.remove_folder_ok"), deleted.is_ok());
    let _ = std::fs::remove_dir_all(&folder);
    Ok(())
}

/// Another process holding a file open.
struct Holder {
    child: Child,
    lines: BufReader<ChildStdout>,
}

impl Holder {
    fn start(path: &Path, share: &str) -> Result<Holder, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut child = Command::new(exe)
            .arg("hold")
            .arg(path)
            .args(["--share", share])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let stdout = child.stdout.take().ok_or("no output")?;
        let mut holder = Holder {
            child,
            lines: BufReader::new(stdout),
        };
        let line = holder.line()?;
        if line != "HELD" {
            return Err(format!("the holder said {line:?}"));
        }
        Ok(holder)
    }

    fn line(&mut self) -> Result<String, String> {
        let mut line = String::new();
        self.lines.read_line(&mut line).map_err(|e| e.to_string())?;
        Ok(line.trim_end().to_owned())
    }

    /// Asks the holder to read the file through its handle, and returns what it saw. The holder then exits.
    fn read(&mut self) -> Result<String, String> {
        let stdin = self.child.stdin.as_mut().ok_or("no input")?;
        writeln!(stdin, "read").map_err(|e| e.to_string())?;
        let line = self.line()?;
        let _ = self.child.wait();
        Ok(line.strip_prefix("READ ").unwrap_or(&line).to_owned())
    }
}

/// `hold <file> --share <r|rw|rwd>`: holds a file open for M6.
pub fn hold(options: &Options) -> Result<(), String> {
    let path = options.positionals.get(1).ok_or("hold needs a file")?;
    let share = options.value("share").unwrap_or_else(|| "rwd".into());
    let mut file = open_shared(Path::new(path), &share).map_err(|e| format!("{path}: {e}"))?;
    crate::workload::say("HELD");
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.rewind().map_err(|e| e.to_string())?;
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    crate::workload::say(&format!("READ {}", String::from_utf8_lossy(&bytes)));
    Ok(())
}

#[cfg(windows)]
fn open_shared(path: &Path, share: &str) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    let mode = share.chars().fold(0, |mode, c| match c {
        'r' => mode | 1,
        'w' => mode | 2,
        'd' => mode | 4,
        _ => mode,
    });
    std::fs::OpenOptions::new().read(true).share_mode(mode).open(path)
}

#[cfg(not(windows))]
fn open_shared(path: &Path, _share: &str) -> std::io::Result<std::fs::File> {
    std::fs::File::open(path)
}
