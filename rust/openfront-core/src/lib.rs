//! Deterministic simulation primitives shared by future OpenFront Rust ports.
//!
//! Browser, rendering, networking, and JavaScript bindings deliberately stay
//! outside this crate so the simulation can be tested without a runtime.

pub mod geometry;

pub use geometry::{Coord, GridError, GridGeometry, NeighborRefs, TileRef};
