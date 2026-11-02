//! `opennote`: see `opennote --help` and docs/help/command-line.md.

use std::io::{self, IsTerminal, Read};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    let env = opennote_cli::Env::from_system();
    #[cfg(not(windows))]
    let env = {
        let folder = opennote_cli::session::local_folder();
        // The key lives in a file in the app's folder, so it survives between runs; with no home folder it is lost.
        let secrets: std::sync::Arc<dyn opennote_cli::store::Secrets> = match &folder {
            Some(folder) => std::sync::Arc::new(opennote_cli::store::FileSecrets::new(folder)),
            None => std::sync::Arc::new(opennote_cli::store::MemorySecrets::default()),
        };
        opennote_cli::Env::from_folder(folder.as_deref(), secrets)
    };
    // A command reads its text from standard input only when something is piped in, so it never waits on a
    // terminal. The MCP server always reads it.
    let piped = !io::stdin().is_terminal() || args.iter().any(|arg| arg == "mcp");
    let mut stdin: Box<dyn Read> = if piped {
        Box::new(io::stdin())
    } else {
        Box::new(io::empty())
    };
    let code = opennote_cli::run(&args, &env, &mut stdin, &mut io::stdout(), &mut io::stderr());
    std::process::exit(code);
}
