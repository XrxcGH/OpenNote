//! Adds function names to a crash report, from symbol tables of the build that crashed.
//!
//! ```text
//! opennote-symbolicate REPORT.json SYMBOLS... [--out FILE]
//! ```
//!
//! `SYMBOLS` is a `.sym` file or a folder of them (Breakpad symbol files, which `dump_syms` writes from the
//! `.pdb` of a build). The report goes to standard output as JSON, or to `--out`, and a readable stack goes to
//! standard error. A frame is named only by the table whose debug id equals the frame's, so a table of another
//! build is never applied. The exit code is 0 when the report was read and written, 1 for bad arguments, or an
//! unreadable report, and 2 when no frame could be named.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use opennote_crashreport::{Report, Scrubber, SymbolError, SymbolSet, SymbolTable};

struct Arguments {
    report: PathBuf,
    symbols: Vec<PathBuf>,
    out: Option<PathBuf>,
}

fn parse(args: impl Iterator<Item = String>) -> Result<Arguments, String> {
    let mut paths = Vec::new();
    let mut out = None;
    let mut args = args;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--out" => out = Some(PathBuf::from(args.next().ok_or("--out needs a file name")?)),
            "-h" | "--help" => return Err(String::new()),
            flag if flag.starts_with("--") => return Err(format!("unknown option {flag}")),
            _ => paths.push(PathBuf::from(arg)),
        }
    }
    if paths.len() < 2 {
        return Err("give a report and at least one symbol file or folder".to_owned());
    }
    let report = paths.remove(0);
    Ok(Arguments {
        report,
        symbols: paths,
        out,
    })
}

fn load_symbols(paths: &[PathBuf]) -> Result<SymbolSet, String> {
    let mut set = SymbolSet::new();
    for path in paths {
        if path.is_dir() {
            let (found, skipped) = SymbolSet::load_dir(path);
            for skip in skipped {
                eprintln!("skipped {}: {}", skip.file, skip.error);
            }
            for table in found.tables() {
                set.add(table.clone());
            }
        } else {
            let table = SymbolTable::load(path).map_err(|err: SymbolError| format!("{}: {err}", path.display()))?;
            set.add(table);
        }
    }
    Ok(set)
}

fn describe(report: &Report) -> String {
    let mut text = String::new();
    for frame in &report.frames {
        let name = frame.function.as_deref().unwrap_or("?");
        text.push_str(&format!("  {}+{}  {name}\n", frame.module, frame.offset));
    }
    text
}

fn run() -> Result<ExitCode, String> {
    let arguments = match parse(std::env::args().skip(1)) {
        Ok(arguments) => arguments,
        Err(message) if message.is_empty() => {
            println!("usage: opennote-symbolicate REPORT.json SYMBOLS... [--out FILE]");
            return Ok(ExitCode::SUCCESS);
        }
        Err(message) => return Err(message),
    };
    let json =
        std::fs::read_to_string(&arguments.report).map_err(|err| format!("{}: {err}", arguments.report.display()))?;
    let report =
        Report::from_json(&json).map_err(|err| format!("{}: not a crash report: {err}", arguments.report.display()))?;
    let symbols = load_symbols(&arguments.symbols)?;
    // The names pass through the scrubber, which knows no names here: the sender already scrubbed the report.
    let scrubber = Scrubber::new();
    let (done, counts) = report.scrubbed(&scrubber).symbolicated(&symbols, &scrubber);
    match &arguments.out {
        Some(out) => write(out, &done.to_json())?,
        None => print!("{}", done.to_json()),
    }
    eprintln!(
        "{} of {} frames named\n{}",
        counts.resolved,
        done.frames.len(),
        describe(&done)
    );
    Ok(if counts.resolved == 0 && !done.frames.is_empty() {
        ExitCode::from(2)
    } else {
        ExitCode::SUCCESS
    })
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|err| format!("{}: {err}", path.display()))
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(message) => {
            eprintln!("opennote-symbolicate: {message}");
            ExitCode::from(1)
        }
    }
}
