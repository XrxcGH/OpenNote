//! The sample notebook generator and the benchmarks of plan 13.9, which the `opennote-perf` command runs.
//!
//! Each suite lives in its own module, owned by the work package it measures, and adds its measurements to a
//! [`harness::Report`].

pub mod bench_format;
pub mod bench_ops;
pub mod bench_session;
pub mod bench_startup;
pub mod bench_store;
pub mod generate;
pub mod harness;
pub mod memory;
