//! Dependency-free WebAssembly ABI for the deterministic OpenFront map core.
//!
//! JavaScript uploads byte buffers directly into WebAssembly linear memory,
//! while Rust retains ownership of every allocation. Query results are copied
//! into reusable result buffers and exposed by pointer/length accessors.

use openfront_core::{
    build_terrain_rgba_in_place, BoundedWaterPathFinder, GameMapError, GameMapStore,
    HierarchicalWaterPathFinder, PackedTile, RailPathFinder, TerrainGraphicsError, TerrainPalette,
    TileRef, TileStateError, WaterPathFinder, DEFAULT_CLUSTER_SIZE,
};
use std::cell::{Cell, RefCell};

const ABI_VERSION: u32 = 1;
const INVALID_RESULT: u32 = u32::MAX;

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    None = 0,
    InvalidHandle = 1,
    InvalidTile = 2,
    InvalidDimensions = 3,
    TerrainLengthMismatch = 4,
    MaskLengthMismatch = 5,
    OwnerIdOutOfRange = 6,
    InvalidBufferIndex = 7,
    TileListLengthMismatch = 8,
    UnitRecordLengthMismatch = 9,
    StructureRecordLengthMismatch = 10,
    DefenseRecordLengthMismatch = 11,
    PathRecordLengthMismatch = 12,
    InvalidCellSize = 13,
    TrajectoryRecordLengthMismatch = 14,
    InvalidTrajectorySegmentCount = 15,
    InvalidSpiralSegment = 16,
    AiCoalitionRecordLengthMismatch = 17,
    AiOpponentRecordLengthMismatch = 18,
    InternalInvariant = 255,
}

thread_local! {
    static MAPS: RefCell<Vec<Option<GameMapStore>>> = const { RefCell::new(Vec::new()) };
    static WATER_FINDERS: RefCell<Vec<Option<WaterPathFinder>>> = const { RefCell::new(Vec::new()) };
    static HIERARCHICAL_WATER_FINDERS: RefCell<Vec<Option<HierarchicalWaterPathFinder>>> = const { RefCell::new(Vec::new()) };
    static BOUNDED_WATER_FINDERS: RefCell<Vec<Option<BoundedWaterPathFinder>>> = const { RefCell::new(Vec::new()) };
    static RAIL_FINDERS: RefCell<Vec<Option<RailPathFinder>>> = const { RefCell::new(Vec::new()) };
    static DEFENSE_INDICES: RefCell<Vec<Option<openfront_core::DefenseIndex>>> = const { RefCell::new(Vec::new()) };
    static STRUCTURE_RENDERERS: RefCell<Vec<Option<WasmStructureRenderer>>> = const { RefCell::new(Vec::new()) };
    static UPLOADS: RefCell<Vec<Option<Vec<u8>>>> = const { RefCell::new(Vec::new()) };
    static RESULT: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
    static RESULT_F32: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
    static RESULT_F64: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static LAST_ERROR: Cell<u32> = const { Cell::new(ErrorCode::None as u32) };
}

fn begin_call() {
    LAST_ERROR.with(|error| error.set(ErrorCode::None as u32));
}

fn fail(code: ErrorCode) {
    LAST_ERROR.with(|error| error.set(code as u32));
}

fn map_error(error: GameMapError) -> ErrorCode {
    match error {
        GameMapError::Grid(_) => ErrorCode::InvalidDimensions,
        GameMapError::TerrainLengthMismatch { .. } => ErrorCode::TerrainLengthMismatch,
        GameMapError::InvalidTile { .. } => ErrorCode::InvalidTile,
        GameMapError::TileState(TileStateError::OwnerIdOutOfRange { .. }) => {
            ErrorCode::OwnerIdOutOfRange
        }
    }
}

fn slot_index(handle: u32) -> Option<usize> {
    handle.checked_sub(1).map(|index| index as usize)
}

fn insert_slot<T>(slots: &mut Vec<Option<T>>, value: T) -> u32 {
    if let Some((index, slot)) = slots
        .iter_mut()
        .enumerate()
        .find(|(_, slot)| slot.is_none())
    {
        *slot = Some(value);
        return (index + 1) as u32;
    }

    slots.push(Some(value));
    slots.len() as u32
}

fn remove_slot<T>(slots: &mut [Option<T>], handle: u32) -> bool {
    let Some(index) = slot_index(handle) else {
        return false;
    };
    let Some(slot) = slots.get_mut(index) else {
        return false;
    };
    slot.take().is_some()
}

fn with_map<R>(handle: u32, operation: impl FnOnce(&GameMapStore) -> R) -> Option<R> {
    MAPS.with(|maps| {
        let maps = maps.borrow();
        let index = slot_index(handle)?;
        Some(operation(maps.get(index)?.as_ref()?))
    })
}

fn with_map_mut<R>(handle: u32, operation: impl FnOnce(&mut GameMapStore) -> R) -> Option<R> {
    MAPS.with(|maps| {
        let mut maps = maps.borrow_mut();
        let index = slot_index(handle)?;
        Some(operation(maps.get_mut(index)?.as_mut()?))
    })
}

fn set_result(values: impl IntoIterator<Item = u32>) {
    RESULT.with(|result| {
        let mut result = result.borrow_mut();
        result.clear();
        result.extend(values);
    });
}

fn set_f64_result(values: impl IntoIterator<Item = f64>) {
    RESULT_F64.with(|result| {
        let mut result = result.borrow_mut();
        result.clear();
        result.extend(values);
    });
}

fn query_tiles(
    map_handle: u32,
    query: impl FnOnce(&GameMapStore) -> Result<Vec<TileRef>, GameMapError>,
) -> u32 {
    begin_call();
    let Some(result) = with_map(map_handle, query) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(tiles) => {
            set_result(tiles.into_iter().map(TileRef::get));
            1
        }
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}

include!("abi.rs");
include!("upload.rs");
include!("graphics.rs");
include!("units.rs");
include!("structure_render.rs");
include!("ai.rs");
include!("ai_tactics.rs");
include!("ai_alliance.rs");
include!("ai_forecast.rs");
include!("ai_learning.rs");
include!("map_lifecycle.rs");
include!("map_mutation.rs");
include!("query.rs");
include!("components_query.rs");
include!("abstract_graph_query.rs");
include!("rail_query.rs");
include!("water_query.rs");
include!("hierarchical_water_query.rs");
include!("bounded_water_query.rs");
include!("defense_query.rs");
include!("trajectory.rs");
include!("spiral_trail.rs");
include!("tests.rs");
