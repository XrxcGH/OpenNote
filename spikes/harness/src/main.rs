//! Phase 1 spikes (docs/DEVELOPMENT.md, Phase 1): throwaway experiments that answer the riskiest questions
//! before real code depends on them. Each spike measures one thing on Windows and writes its results to
//! `spikes/results/<spike>.json`, which its architecture decision record (ADR) quotes.
//!
//! Usage: `opennote-spikes <ink|text|pdf|audio> [--auto] [--mode <name>] [--samples <n>] [--out <file>]`

#[cfg(windows)]
mod audio;
// Each spike uses only some of the shared tools.
#[cfg(windows)]
#[allow(dead_code)]
mod common;
#[cfg(windows)]
mod ink;
#[cfg(windows)]
mod pdf;
#[cfg(windows)]
mod text;

mod options;

fn main() {
    let options = match options::Options::parse(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            eprintln!("{message}\n\n{}", options::USAGE);
            std::process::exit(2);
        }
    };
    #[cfg(windows)]
    {
        let outcome = match options.spike {
            options::Spike::Ink => ink::run(&options),
            options::Spike::Text => text::run(&options),
            options::Spike::Pdf => pdf::run(&options),
            options::Spike::Audio => audio::run(&options),
        };
        if let Err(error) = outcome {
            eprintln!("The {} spike failed: {error}", options.spike.name());
            std::process::exit(1);
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("The {} spike runs on Windows only.", options.spike.name());
        std::process::exit(2);
    }
}
