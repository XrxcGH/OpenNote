//! Ink latency: how long a pen stroke takes to reach the screen in WebView2 (spike 1).

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
