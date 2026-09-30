//! Structural checks of a page (spec 16). Owned by WP1.

use crate::limits::Limits;
use crate::model::{Page, Warning};

/// The problems a page has: errors make it damaged, and warnings are corrected at the next save.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ValidationReport {
    /// Problems that make the page damaged and read-only.
    pub errors: Vec<Warning>,
    /// Problems a writer corrects at the next save, such as a wrong `strokeCount`.
    pub warnings: Vec<Warning>,
}

impl ValidationReport {
    /// Whether the page has no errors.
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Checks every limit and structural rule of spec 16 on a page.
pub fn validate_page(_page: &Page, _limits: &Limits) -> ValidationReport {
    unimplemented!("WP1: validate_page")
}
