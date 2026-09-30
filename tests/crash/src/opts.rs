//! Command-line options: `--name value`, `--flag`, and positional arguments.

use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;

/// Options that take no value.
const FLAGS: [&str; 4] = ["sabotage", "no-hostile", "setup", "reference"];

/// Parsed options.
#[derive(Debug, Default)]
pub struct Options {
    values: HashMap<String, String>,
    flags: Vec<String>,
    /// Arguments that aren't options, in order.
    pub positionals: Vec<String>,
}

impl Options {
    /// Parses `args`.
    pub fn parse(args: &[String]) -> Result<Options, String> {
        let mut options = Options::default();
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            match arg.strip_prefix("--") {
                Some(name) if FLAGS.contains(&name) => options.flags.push(name.to_owned()),
                Some(name) => {
                    let value = args.next().ok_or_else(|| format!("--{name} needs a value"))?;
                    options.values.insert(name.to_owned(), value.clone());
                }
                None => options.positionals.push(arg.clone()),
            }
        }
        Ok(options)
    }

    /// Whether a flag was given.
    pub fn flag(&self, name: &str) -> bool {
        self.flags.iter().any(|f| f == name)
    }

    /// An option's value.
    pub fn value(&self, name: &str) -> Option<String> {
        self.values.get(name).cloned()
    }

    /// A required path.
    pub fn path(&self, name: &str) -> Result<PathBuf, String> {
        self.value(name)
            .map(PathBuf::from)
            .ok_or_else(|| format!("--{name} is required"))
    }

    /// A number, or `default` when the option is missing.
    pub fn number<T: FromStr>(&self, name: &str, default: T) -> Result<T, String> {
        match self.values.get(name) {
            Some(text) => text
                .parse()
                .map_err(|_| format!("--{name} must be a number, not {text:?}")),
            None => Ok(default),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn parses_values_flags_and_positionals() {
        let options = Options::parse(&strings(&["m5", "--runs", "40", "--sabotage", "--dir", "x"])).unwrap();
        assert_eq!(options.number("runs", 0u32).unwrap(), 40);
        assert_eq!(options.number("seed", 7u64).unwrap(), 7);
        assert!(options.flag("sabotage") && !options.flag("keep"));
        assert_eq!(options.path("dir").unwrap(), PathBuf::from("x"));
        assert!(options.path("notebook").is_err());
        assert_eq!(options.positionals, ["m5"]);
        assert!(Options::parse(&strings(&["--runs"])).is_err());
        assert!(Options::parse(&strings(&["--runs", "x"]))
            .unwrap()
            .number("runs", 0u32)
            .is_err());
    }
}
