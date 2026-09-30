//! PDF export: WebView2 print-to-PDF of a paginated page, compared with the screen (spike 3).

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
