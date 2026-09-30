//! The start-up frame probe (ARCHITECTURE.md section 21.7). It will sample the OpenNote window with GDI every
//! 16 ms, from window creation until the page is ready. It fails when a frame shows a large area of white or of
//! the other theme's `surface.app`. The nightly workflow runs it without blocking. This empty binary holds its
//! place in the workspace until the shell work package builds it.

fn main() {}
