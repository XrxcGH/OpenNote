//! Image import (Phase 4 ARCHITECTURE.md section 12; owner after WP0: WP5): each image is probed with Windows Imaging
//! Component, then stored in the page's assets through the core. WP0's commands answer notImplemented.

pub mod import;
pub mod probe;
pub mod renditions;
pub mod web;

pub use import::{image_import, image_import_clip, ImportedAsset};
pub use probe::{probe, ImageFormat, Probe, ProbeError};
pub use renditions::register_renditions;
pub use web::image_import_url;
