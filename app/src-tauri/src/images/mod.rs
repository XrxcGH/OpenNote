//! Image import (Phase 4 ARCHITECTURE.md section 12): each image is probed from its header, checked, and stored in
//! the page's assets through the core.

mod convert;
mod header;
pub mod import;
pub mod probe;
mod protocol;
pub mod renditions;
mod svg;
pub mod web;
#[cfg(windows)]
mod wic;

pub use import::{image_import, image_import_clip, ImportedAsset};
pub use probe::{probe, ImageFormat, Probe, ProbeError};
pub use renditions::register_renditions;
pub use web::image_import_url;
