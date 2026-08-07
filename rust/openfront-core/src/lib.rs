//! Deterministic simulation primitives shared by future OpenFront Rust ports.
//!
//! Browser, rendering, networking, and JavaScript bindings deliberately stay
//! outside this crate so the simulation can be tested without a runtime.

pub mod abstract_graph;
pub mod abstract_graph_builder;
pub mod air_path;
pub mod bfs_grid;
pub mod connected_components;
pub mod geometry;
pub mod graphics;
pub mod hierarchical_water;
pub mod map;
pub mod rail_path;
pub mod random;
pub mod territory;
pub mod tile;
pub mod traversal;
pub mod water_bounded;
pub mod water_path;

pub use abstract_graph::{AbstractEdge, AbstractGraph, AbstractGraphAStar, AbstractNode, Cluster};
pub use abstract_graph_builder::{AbstractGraphBuilder, DEFAULT_CLUSTER_SIZE};
pub use air_path::{air_path, AirPathError};
pub use bfs_grid::{BfsGrid, BfsVisit};
pub use connected_components::{ConnectedWaterComponents, LAND_COMPONENT_MARKER};
pub use geometry::{Coord, GridError, GridGeometry, NeighborRefs, TileRef};
pub use graphics::{
    build_terrain_rgba, build_terrain_rgba_in_place, encode_terrain_rgba, TerrainGraphicsError,
    TerrainPalette,
};
pub use hierarchical_water::HierarchicalWaterPathFinder;
pub use map::{GameMapError, GameMapStore};
pub use rail_path::{rail_path, RailPathFinder};
pub use random::PseudoRandom;
pub use territory::OwnerTerritoryAnalysis;
pub use tile::{
    apply_packed_update, PackedTile, Terrain, TerrainType, TileState, TileStateError,
    TileTransition, DEFENSE_BONUS_MASK, FALLOUT_MASK, IMPASSABLE_MAGNITUDE, OWNER_ID_MASK,
    TERRAIN_LAND_MASK, TERRAIN_MAGNITUDE_MASK, TERRAIN_OCEAN_MASK, TERRAIN_SHORELINE_MASK,
};
pub use traversal::NeighborRefs8;
pub use water_bounded::{BoundedWaterPathFinder, SearchBounds};
pub use water_path::WaterPathFinder;
