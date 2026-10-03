//! Display-size renditions behind `page.imageRenditions` (owner after WP0: WP5). Spike S3 decides whether they're
//! built; until then registering them changes nothing.

use tauri::{Builder, Wry};

pub fn register_renditions(builder: Builder<Wry>) -> Builder<Wry> {
    builder
}
