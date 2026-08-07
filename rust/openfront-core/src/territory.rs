//! Owner-centric territory analysis for AI and simulation hot paths.

use crate::{GameMapError, GameMapStore, TileRef};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerTerritoryAnalysis {
    pub tile_count: u32,
    pub borders: Vec<TileRef>,
    pub depths: Vec<(TileRef, u32)>,
}

impl GameMapStore {
    /// Counts tiles owned by one player in a single contiguous-state scan.
    pub fn owner_tile_count(&self, owner_id: u16) -> Result<u32, GameMapError> {
        let mut count = 0_u32;
        for tile in self.tiles() {
            if self.state(tile)?.owner_id() == owner_id {
                count += 1;
            }
        }
        Ok(count)
    }

    /// Returns owned border tiles in row-major map order.
    pub fn owner_border_tiles(&self, owner_id: u16) -> Result<Vec<TileRef>, GameMapError> {
        let mut borders = Vec::new();
        for tile in self.tiles() {
            if self.state(tile)?.owner_id() != owner_id {
                continue;
            }
            let neighbors = self.neighbors4(tile)?;
            if neighbors
                .as_slice()
                .iter()
                .any(|neighbor| self.state(*neighbor).map(|state| state.owner_id() != owner_id).unwrap_or(false))
            {
                borders.push(tile);
            }
        }
        Ok(borders)
    }

    /// Performs the complete owner-specific interior-building preparation in
    /// Rust so callers cross the Wasm boundary once rather than once per scan.
    pub fn analyze_owner_territory(
        &self,
        owner_id: u16,
        maximum_depth: u32,
    ) -> Result<OwnerTerritoryAnalysis, GameMapError> {
        let mut tile_count = 0_u32;
        let mut borders = Vec::new();

        for tile in self.tiles() {
            if self.state(tile)?.owner_id() != owner_id {
                continue;
            }
            tile_count += 1;
            let neighbors = self.neighbors4(tile)?;
            if neighbors
                .as_slice()
                .iter()
                .any(|neighbor| self.state(*neighbor).map(|state| state.owner_id() != owner_id).unwrap_or(false))
            {
                borders.push(tile);
            }
        }

        let depths = if borders.is_empty() {
            Vec::new()
        } else {
            self.owned_depths(&borders, owner_id, maximum_depth)?
        };

        Ok(OwnerTerritoryAnalysis {
            tile_count,
            borders,
            depths,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Coord, TERRAIN_LAND_MASK};

    fn tile(map: &GameMapStore, x: u32, y: u32) -> TileRef {
        map.tile_ref(Coord::new(x, y)).unwrap()
    }

    #[test]
    fn analyzes_owner_count_borders_and_depths() {
        let mut map = GameMapStore::new(5, 3, vec![TERRAIN_LAND_MASK | 1; 15]).unwrap();
        for y in 0..3 {
            for x in 0..4 {
                map.set_owner_id(tile(&map, x, y), 7).unwrap();
            }
        }

        let analysis = map.analyze_owner_territory(7, 4).unwrap();
        assert_eq!(analysis.tile_count, 12);
        assert!(!analysis.borders.is_empty());
        assert_eq!(analysis.depths.first().map(|entry| entry.1), Some(0));
        assert!(analysis.depths.iter().all(|(t, _)| map.state(*t).unwrap().owner_id() == 7));
    }

    #[test]
    fn missing_owner_returns_empty_analysis() {
        let map = GameMapStore::new(2, 2, vec![TERRAIN_LAND_MASK | 1; 4]).unwrap();
        let analysis = map.analyze_owner_territory(9, 3).unwrap();
        assert_eq!(analysis.tile_count, 0);
        assert!(analysis.borders.is_empty());
        assert!(analysis.depths.is_empty());
    }
}
