//! Command-line options shared by every spike.

use std::path::PathBuf;

pub const USAGE: &str = "Usage: opennote-spikes <ink|text|pdf|audio> [options]

Options:
  --auto           Run the automated measurement, write the results, and exit.
                   Without it, the spike opens for a person to try by hand.
  --mode <name>    Run only one mode of the spike, such as one ink renderer.
  --samples <n>    How many samples to take in each mode.
  --out <file>     Where to write the results (default: spikes/results/<spike>.json).";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spike {
    Ink,
    Text,
    Pdf,
    Audio,
}

impl Spike {
    pub fn name(self) -> &'static str {
        match self {
            Spike::Ink => "ink",
            Spike::Text => "text",
            Spike::Pdf => "pdf",
            Spike::Audio => "audio",
        }
    }

    fn from_name(name: &str) -> Option<Spike> {
        [Spike::Ink, Spike::Text, Spike::Pdf, Spike::Audio]
            .into_iter()
            .find(|spike| spike.name() == name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Options {
    pub spike: Spike,
    pub auto: bool,
    pub mode: Option<String>,
    pub samples: Option<usize>,
    pub out: Option<PathBuf>,
}

impl Options {
    pub fn parse(mut args: impl Iterator<Item = String>) -> Result<Options, String> {
        let name = args.next().ok_or("Name a spike to run.")?;
        let spike = Spike::from_name(&name).ok_or_else(|| format!("There is no spike named \"{name}\"."))?;
        let mut options = Options {
            spike,
            auto: false,
            mode: None,
            samples: None,
            out: None,
        };
        while let Some(flag) = args.next() {
            let mut value = || args.next().ok_or_else(|| format!("{flag} needs a value."));
            match flag.as_str() {
                "--auto" => options.auto = true,
                "--mode" => options.mode = Some(value()?),
                "--samples" => {
                    let raw = value()?;
                    let samples = raw
                        .parse()
                        .map_err(|_| format!("--samples needs a number, not \"{raw}\"."))?;
                    options.samples = Some(samples);
                }
                "--out" => options.out = Some(PathBuf::from(value()?)),
                _ => return Err(format!("Unknown option \"{flag}\".")),
            }
        }
        Ok(options)
    }

    /// The results file: `--out`, or `spikes/results/<spike>.json` in the repository.
    pub fn results_path(&self) -> PathBuf {
        self.out.clone().unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../results")
                .join(format!("{}.json", self.spike.name()))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Options, String> {
        Options::parse(args.iter().map(|arg| arg.to_string()))
    }

    #[test]
    fn parses_a_spike_and_its_flags() {
        let options = parse(&["ink", "--auto", "--mode", "canvas2d", "--samples", "50"]).unwrap();
        assert_eq!(options.spike, Spike::Ink);
        assert!(options.auto);
        assert_eq!(options.mode.as_deref(), Some("canvas2d"));
        assert_eq!(options.samples, Some(50));
        assert!(options.results_path().ends_with("results/ink.json"));
    }

    #[test]
    fn rejects_unknown_spikes_and_flags() {
        assert!(parse(&[]).is_err());
        assert!(parse(&["video"]).is_err());
        assert!(parse(&["audio", "--fast"]).is_err());
        assert!(parse(&["audio", "--samples", "many"]).is_err());
        assert!(parse(&["audio", "--out"]).is_err());
    }
}
