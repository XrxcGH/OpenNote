//! Text on a freeform page: typing latency with several Tiptap editors on a zoomable canvas mixed with ink (spike 2).

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
