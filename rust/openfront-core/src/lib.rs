//! Deterministic simulation primitives shared by future OpenFront Rust ports.
//!
//! Browser, rendering, networking, and JavaScript bindings deliberately stay
//! outside this crate so the simulation can be tested without a runtime.

pub mod geometry;
pub mod tile;

pub use geometry::{Coord, GridError, GridGeometry, NeighborRefs, TileRef};
pub use tile::{
    apply_packed_update, PackedTile, Terrain, TerrainType, TileState, TileStateError,
    TileTransition, DEFENSE_BONUS_MASK, FALLOUT_MASK, IMPASSABLE_MAGNITUDE,
    OWNER_ID_MASK, TERRAIN_LAND_MASK, TERRAIN_MAGNITUDE_MASK, TERRAIN_OCEAN_MASK,
    TERRAIN_SHORELINE_MASK,
};
