//! Contiguous map storage matching the mutable parts of `GameMapImpl`.
//!
//! Geometry, terrain, and state remain separate so hot loops can read compact
//! buffers without allocating wrapper objects per tile.

use crate::geometry::{Coord, GridError, GridGeometry, NeighborRefs, TileRef};
use crate::tile::{
    apply_packed_update, PackedTile, Terrain, TileState, TileStateError, TileTransition,
};

/// Errors produced while constructing or accessing a map store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameMapError {
    Grid(GridError),
    TerrainLengthMismatch { expected: usize, actual: usize },
    InvalidTile { tile: TileRef },
    TileState(TileStateError),
}

impl From<GridError> for GameMapError {
    fn from(error: GridError) -> Self {
        Self::Grid(error)
    }
}

impl From<TileStateError> for GameMapError {
    fn from(error: TileStateError) -> Self {
        Self::TileState(error)
    }
}

/// A rectangular map with contiguous terrain and mutable state buffers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameMapStore {
    geometry: GridGeometry,
    terrain: Vec<Terrain>,
    state: Vec<TileState>,
    num_land_tiles: u32,
    num_tiles_with_fallout: u32,
}

impl GameMapStore {
    /// Creates a map from the same one-byte-per-tile terrain representation
    /// consumed by the TypeScript `GameMapImpl` constructor.
    pub fn new(
        width: u32,
        height: u32,
        terrain_bytes: Vec<u8>,
    ) -> Result<Self, GameMapError> {
        let geometry = GridGeometry::new(width, height)?;
        let expected = geometry.tile_count() as usize;
        let actual = terrain_bytes.len();
        if actual != expected {
            return Err(GameMapError::TerrainLengthMismatch { expected, actual });
        }

        let terrain: Vec<Terrain> = terrain_bytes
            .into_iter()
            .map(Terrain::from_byte)
            .collect();
        let num_land_tiles = terrain.iter().filter(|tile| tile.is_land()).count() as u32;

        Ok(Self {
            geometry,
            terrain,
            state: vec![TileState::default(); expected],
            num_land_tiles,
            num_tiles_with_fallout: 0,
        })
    }

    #[must_use]
    pub const fn geometry(&self) -> GridGeometry {
        self.geometry
    }

    #[must_use]
    pub const fn width(&self) -> u32 {
        self.geometry.width()
    }

    #[must_use]
    pub const fn height(&self) -> u32 {
        self.geometry.height()
    }

    #[must_use]
    pub const fn tile_count(&self) -> u32 {
        self.geometry.tile_count()
    }

    #[must_use]
    pub const fn num_land_tiles(&self) -> u32 {
        self.num_land_tiles
    }

    #[must_use]
    pub const fn num_tiles_with_fallout(&self) -> u32 {
        self.num_tiles_with_fallout
    }

    #[must_use]
    pub fn terrain_buffer(&self) -> &[Terrain] {
        &self.terrain
    }

    #[must_use]
    pub fn state_buffer(&self) -> &[TileState] {
        &self.state
    }

    pub fn tiles(&self) -> impl Iterator<Item = TileRef> + '_ {
        (0..self.tile_count()).map(TileRef::new)
    }

    pub fn tile_ref(&self, coord: Coord) -> Result<TileRef, GameMapError> {
        self.geometry
            .tile_ref(coord)
            .ok_or(GameMapError::InvalidTile {
                tile: TileRef::new(self.tile_count()),
            })
    }

    pub fn coord(&self, tile: TileRef) -> Result<Coord, GameMapError> {
        self.geometry
            .coord(tile)
            .ok_or(GameMapError::InvalidTile { tile })
    }

    pub fn terrain(&self, tile: TileRef) -> Result<Terrain, GameMapError> {
        Ok(self.terrain[self.index(tile)?])
    }

    pub fn state(&self, tile: TileRef) -> Result<TileState, GameMapError> {
        Ok(self.state[self.index(tile)?])
    }

    pub fn packed_tile(&self, tile: TileRef) -> Result<PackedTile, GameMapError> {
        Ok(PackedTile::from_parts(
            self.terrain(tile)?,
            self.state(tile)?,
        ))
    }

    pub fn neighbors4(&self, tile: TileRef) -> Result<NeighborRefs, GameMapError> {
        self.geometry
            .neighbors4(tile)
            .ok_or(GameMapError::InvalidTile { tile })
    }

    pub fn set_water(&mut self, tile: TileRef) -> Result<bool, GameMapError> {
        let index = self.index(tile)?;
        let changed = self.terrain[index].set_water();
        if changed {
            self.num_land_tiles = self
                .num_land_tiles
                .checked_sub(1)
                .expect("land counter matches terrain buffer");
        }
        Ok(changed)
    }

    pub fn set_shoreline(&mut self, tile: TileRef, value: bool) -> Result<(), GameMapError> {
        let index = self.index(tile)?;
        self.terrain[index].set_shoreline(value);
        Ok(())
    }

    pub fn set_ocean(&mut self, tile: TileRef) -> Result<(), GameMapError> {
        let index = self.index(tile)?;
        self.terrain[index].set_ocean();
        Ok(())
    }

    pub fn set_magnitude(&mut self, tile: TileRef, value: u8) -> Result<(), GameMapError> {
        let index = self.index(tile)?;
        self.terrain[index].set_magnitude(value);
        Ok(())
    }

    pub fn set_owner_id(&mut self, tile: TileRef, owner_id: u32) -> Result<(), GameMapError> {
        let index = self.index(tile)?;
        self.state[index].set_owner_id(owner_id)?;
        Ok(())
    }

    /// Sets fallout and returns whether the bit changed.
    pub fn set_fallout(&mut self, tile: TileRef, value: bool) -> Result<bool, GameMapError> {
        let index = self.index(tile)?;
        let changed = self.state[index].set_fallout(value);
        if changed {
            if value {
                self.num_tiles_with_fallout = self
                    .num_tiles_with_fallout
                    .checked_add(1)
                    .expect("fallout counter fits in the map tile count");
            } else {
                self.num_tiles_with_fallout = self
                    .num_tiles_with_fallout
                    .checked_sub(1)
                    .expect("fallout counter matches state buffer");
            }
        }
        Ok(changed)
    }

    pub fn set_defense_bonus(
        &mut self,
        tile: TileRef,
        value: bool,
    ) -> Result<(), GameMapError> {
        let index = self.index(tile)?;
        self.state[index].set_defense_bonus(value);
        Ok(())
    }

    #[must_use]
    pub fn is_on_edge_of_map(&self, tile: TileRef) -> Result<bool, GameMapError> {
        let coord = self.coord(tile)?;
        Ok(coord.x == 0
            || coord.x == self.width() - 1
            || coord.y == 0
            || coord.y == self.height() - 1)
    }

    #[must_use]
    pub fn is_border(&self, tile: TileRef) -> Result<bool, GameMapError> {
        let owner = self.state(tile)?.owner_id();
        let neighbors = self.neighbors4(tile)?;
        for neighbor in neighbors.as_slice() {
            if self.state(*neighbor)?.owner_id() != owner {
                return Ok(true);
            }
        }
        Ok(false)
    }

    #[must_use]
    pub fn is_ocean_shore(&self, tile: TileRef) -> Result<bool, GameMapError> {
        if !self.terrain(tile)?.is_land() {
            return Ok(false);
        }
        let neighbors = self.neighbors4(tile)?;
        for neighbor in neighbors.as_slice() {
            if self.terrain(*neighbor)?.is_ocean() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Applies a packed state/terrain replacement and returns all counter
    /// changes needed by callers that mirror TypeScript update processing.
    pub fn apply_packed_tile(
        &mut self,
        tile: TileRef,
        packed: PackedTile,
    ) -> Result<TileTransition, GameMapError> {
        let index = self.index(tile)?;
        let transition = apply_packed_update(
            &mut self.terrain[index],
            &mut self.state[index],
            packed,
        );
        adjust_counter(&mut self.num_land_tiles, transition.land_delta);
        adjust_counter(
            &mut self.num_tiles_with_fallout,
            transition.fallout_delta,
        );
        Ok(transition)
    }

    /// Matches `GameMapImpl.updateTile` by returning only whether terrain
    /// changed while still maintaining the Rust-side counters.
    pub fn update_tile(
        &mut self,
        tile: TileRef,
        packed: PackedTile,
    ) -> Result<bool, GameMapError> {
        Ok(self.apply_packed_tile(tile, packed)?.terrain_changed)
    }

    fn index(&self, tile: TileRef) -> Result<usize, GameMapError> {
        if self.geometry.is_valid_ref(tile) {
            Ok(tile.get() as usize)
        } else {
            Err(GameMapError::InvalidTile { tile })
        }
    }
}

fn adjust_counter(counter: &mut u32, delta: i8) {
    match delta {
        -1 => {
            *counter = counter
                .checked_sub(1)
                .expect("counter matches its backing tile buffer");
        }
        0 => {}
        1 => {
            *counter = counter
                .checked_add(1)
                .expect("counter fits in the map tile count");
        }
        _ => unreachable!("tile transitions only produce -1, 0, or 1"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile::{
        FALLOUT_MASK, IMPASSABLE_MAGNITUDE, TERRAIN_LAND_MASK, TERRAIN_OCEAN_MASK,
    };

    fn land(magnitude: u8) -> u8 {
        TERRAIN_LAND_MASK | magnitude
    }

    fn ocean() -> u8 {
        TERRAIN_OCEAN_MASK
    }

    fn tile(map: &GameMapStore, x: u32, y: u32) -> TileRef {
        map.tile_ref(Coord::new(x, y)).unwrap()
    }

    #[test]
    fn validates_dimensions_and_terrain_length() {
        assert_eq!(
            GameMapStore::new(0, 1, Vec::new()),
            Err(GameMapError::Grid(GridError::ZeroWidth))
        );
        assert_eq!(
            GameMapStore::new(2, 2, vec![0; 3]),
            Err(GameMapError::TerrainLengthMismatch {
                expected: 4,
                actual: 3,
            })
        );
    }

    #[test]
    fn initializes_contiguous_buffers_and_land_count() {
        let map = GameMapStore::new(
            2,
            2,
            vec![land(1), ocean(), land(IMPASSABLE_MAGNITUDE), 0],
        )
        .unwrap();

        assert_eq!(map.tile_count(), 4);
        assert_eq!(map.terrain_buffer().len(), 4);
        assert_eq!(map.state_buffer().len(), 4);
        assert_eq!(map.num_land_tiles(), 2);
        assert_eq!(map.num_tiles_with_fallout(), 0);
        assert_eq!(map.tiles().collect::<Vec<_>>(), (0..4).map(TileRef::new).collect::<Vec<_>>());
    }

    #[test]
    fn rejects_invalid_tile_access() {
        let map = GameMapStore::new(2, 2, vec![0; 4]).unwrap();
        let invalid = TileRef::new(4);

        assert_eq!(
            map.terrain(invalid),
            Err(GameMapError::InvalidTile { tile: invalid })
        );
        assert_eq!(
            map.neighbors4(invalid),
            Err(GameMapError::InvalidTile { tile: invalid })
        );
    }

    #[test]
    fn set_water_updates_land_count_once_and_preserves_impassable_land() {
        let mut map = GameMapStore::new(
            2,
            1,
            vec![land(4), land(IMPASSABLE_MAGNITUDE)],
        )
        .unwrap();
        let passable = tile(&map, 0, 0);
        let impassable = tile(&map, 1, 0);

        assert!(map.set_water(passable).unwrap());
        assert_eq!(map.num_land_tiles(), 1);
        assert!(!map.set_water(passable).unwrap());
        assert!(!map.set_water(impassable).unwrap());
        assert_eq!(map.num_land_tiles(), 1);
    }

    #[test]
    fn owner_fallout_and_defense_updates_share_one_state_buffer() {
        let mut map = GameMapStore::new(1, 1, vec![land(3)]).unwrap();
        let tile = tile(&map, 0, 0);

        map.set_owner_id(tile, 17).unwrap();
        assert!(map.set_fallout(tile, true).unwrap());
        assert!(!map.set_fallout(tile, true).unwrap());
        map.set_defense_bonus(tile, true).unwrap();

        let state = map.state(tile).unwrap();
        assert_eq!(state.owner_id(), 17);
        assert!(state.has_fallout());
        assert!(state.has_defense_bonus());
        assert_eq!(map.num_tiles_with_fallout(), 1);

        assert!(map.set_fallout(tile, false).unwrap());
        assert_eq!(map.num_tiles_with_fallout(), 0);
        assert_eq!(map.state(tile).unwrap().bits() & FALLOUT_MASK, 0);
    }

    #[test]
    fn packed_updates_keep_land_and_fallout_counters_in_sync() {
        let mut map = GameMapStore::new(1, 1, vec![land(3)]).unwrap();
        let tile = tile(&map, 0, 0);
        let mut state = TileState::default();
        state.set_fallout(true);
        let packed = PackedTile::from_parts(Terrain::from_byte(ocean()), state);

        let transition = map.apply_packed_tile(tile, packed).unwrap();
        assert_eq!(transition.land_delta, -1);
        assert_eq!(transition.fallout_delta, 1);
        assert_eq!(map.num_land_tiles(), 0);
        assert_eq!(map.num_tiles_with_fallout(), 1);
        assert!(!map.update_tile(tile, packed).unwrap());
    }

    #[test]
    fn border_and_edge_checks_match_existing_neighbor_semantics() {
        let mut map = GameMapStore::new(3, 3, vec![land(2); 9]).unwrap();
        let center = tile(&map, 1, 1);
        let north = tile(&map, 1, 0);
        let corner = tile(&map, 0, 0);

        for tile in map.tiles().collect::<Vec<_>>() {
            map.set_owner_id(tile, 5).unwrap();
        }
        assert!(!map.is_border(center).unwrap());
        assert!(!map.is_on_edge_of_map(center).unwrap());
        assert!(map.is_on_edge_of_map(corner).unwrap());

        map.set_owner_id(north, 9).unwrap();
        assert!(map.is_border(center).unwrap());
        assert!(map.is_border(north).unwrap());
    }

    #[test]
    fn ocean_shore_requires_land_next_to_an_ocean_flag() {
        let map = GameMapStore::new(3, 1, vec![land(1), ocean(), 0]).unwrap();
        let land_tile = tile(&map, 0, 0);
        let ocean_tile = tile(&map, 1, 0);
        let lake_tile = tile(&map, 2, 0);

        assert!(map.is_ocean_shore(land_tile).unwrap());
        assert!(!map.is_ocean_shore(ocean_tile).unwrap());
        assert!(!map.is_ocean_shore(lake_tile).unwrap());
    }
}
