//! Audio capture: the microphone and system audio recorded at the same time with cpal (spike 4).

use crate::common::Result;
use crate::options::Options;

pub fn run(options: &Options) -> Result<()> {
    Err(format!(
        "The {} spike isn't written yet (results would go to {}).",
        options.spike.name(),
        options.results_path().display()
    )
    .into())
}
