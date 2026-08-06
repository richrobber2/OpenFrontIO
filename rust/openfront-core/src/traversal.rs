//! Deterministic neighbor and connected-region traversal.
//!
//! Ordering intentionally matches `GameMapImpl`, including the method named
//! `bfs` using a LIFO `pop()` stack rather than a FIFO queue.

use crate::geometry::{GridGeometry, TileRef};
use crate::map::{GameMapError, GameMapStore};

/// A fixed-capacity eight-neighbor result with no heap allocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NeighborRefs8 {
    refs: [TileRef; 8],
    len: u8,
}

impl NeighborRefs8 {
    const fn empty() -> Self {
        Self {
            refs: [TileRef::new(0); 8],
            len: 0,
        }
    }

    fn push(&mut self, tile: TileRef) {
        debug_assert!((self.len as usize) < self.refs.len());
        self.refs[self.len as usize] = tile;
        self.len += 1;
    }

    #[must_use]
    pub fn as_slice(&self) -> &[TileRef] {
        &self.refs[..self.len as usize]
    }

    #[must_use]
    pub const fn len(&self) -> usize {
        self.len as usize
    }

    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl<'a> IntoIterator for &'a NeighborRefs8 {
    type Item = &'a TileRef;
    type IntoIter = core::slice::Iter<'a, TileRef>;

    fn into_iter(self) -> Self::IntoIter {
        self.as_slice().iter()
    }
}

impl GridGeometry {
    /// Returns adjacent and diagonal neighbors in the exact order used by
    /// `GameMapImpl.forEachNeighborWithDiag`:
    /// northwest, west, southwest, north, south, northeast, east, southeast.
    #[must_use]
    pub fn neighbors8(self, tile: TileRef) -> Option<NeighborRefs8> {
        let coord = self.coord(tile)?;
        let width = self.width();
        let has_north = coord.y > 0;
        let has_south = coord.y + 1 < self.height();
        let mut neighbors = NeighborRefs8::empty();

        if coord.x > 0 {
            if has_north {
                neighbors.push(TileRef::new(tile.get() - 1 - width));
            }
            neighbors.push(TileRef::new(tile.get() - 1));
            if has_south {
                neighbors.push(TileRef::new(tile.get() - 1 + width));
            }
        }
        if has_north {
            neighbors.push(TileRef::new(tile.get() - width));
        }
        if has_south {
            neighbors.push(TileRef::new(tile.get() + width));
        }
        if coord.x + 1 < width {
            if has_north {
                neighbors.push(TileRef::new(tile.get() + 1 - width));
            }
            neighbors.push(TileRef::new(tile.get() + 1));
            if has_south {
                neighbors.push(TileRef::new(tile.get() + 1 + width));
            }
        }

        Some(neighbors)
    }
}

impl GameMapStore {
    pub fn neighbors8(&self, tile: TileRef) -> Result<NeighborRefs8, GameMapError> {
        self.geometry()
            .neighbors8(tile)
            .ok_or(GameMapError::InvalidTile { tile })
    }

    /// Matches `GameMapImpl.bfs`, including its LIFO `pop()` traversal order.
    ///
    /// The returned vector preserves the insertion order of the TypeScript
    /// `Set<TileRef>`. Tiles rejected by the filter are not marked as seen, so
    /// the filter may be called for them again from another accepted tile.
    pub fn bfs<F>(&self, start: TileRef, mut filter: F) -> Result<Vec<TileRef>, GameMapError>
    where
        F: FnMut(&Self, TileRef) -> bool,
    {
        let geometry = self.geometry();
        if !geometry.is_valid_ref(start) {
            return Err(GameMapError::InvalidTile { tile: start });
        }

        let mut seen = vec![false; self.tile_count() as usize];
        let mut stack = Vec::new();
        let mut accepted = Vec::new();

        if filter(self, start) {
            seen[start.get() as usize] = true;
            stack.push(start);
            accepted.push(start);
        }

        while let Some(current) = stack.pop() {
            let neighbors = geometry
                .neighbors4(current)
                .expect("accepted tiles always have valid geometry");
            for neighbor in neighbors.as_slice() {
                let index = neighbor.get() as usize;
                if !seen[index] && filter(self, *neighbor) {
                    seen[index] = true;
                    stack.push(*neighbor);
                    accepted.push(*neighbor);
                }
            }
        }

        Ok(accepted)
    }

    /// Computes the same multi-source owned-land depths used by the AI's
    /// `interiorBuildCandidates` helper.
    ///
    /// Sources are inserted at depth zero in caller order. Expansion uses a
    /// FIFO queue and cardinal neighbors in north, south, west, east order.
    /// Source ownership is intentionally not checked because the TypeScript
    /// helper trusts its border set and only checks ownership for expansion.
    pub fn owned_depths(
        &self,
        starts: &[TileRef],
        owner_id: u16,
        maximum_depth: u32,
    ) -> Result<Vec<(TileRef, u32)>, GameMapError> {
        let geometry = self.geometry();
        let mut seen = vec![false; self.tile_count() as usize];
        let mut queue = Vec::with_capacity(starts.len());

        for start in starts {
            if !geometry.is_valid_ref(*start) {
                return Err(GameMapError::InvalidTile { tile: *start });
            }
            let index = start.get() as usize;
            if seen[index] {
                continue;
            }
            seen[index] = true;
            queue.push((*start, 0));
        }

        let mut cursor = 0;
        while cursor < queue.len() {
            let (current, depth) = queue[cursor];
            cursor += 1;
            if depth >= maximum_depth {
                continue;
            }

            let neighbors = geometry
                .neighbors4(current)
                .expect("queued tiles always have valid geometry");
            for neighbor in neighbors.as_slice() {
                let index = neighbor.get() as usize;
                if seen[index] || self.state(*neighbor)?.owner_id() != owner_id {
                    continue;
                }
                seen[index] = true;
                queue.push((*neighbor, depth + 1));
            }
        }

        Ok(queue)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Coord;
    use crate::tile::TERRAIN_LAND_MASK;

    fn land() -> u8 {
        TERRAIN_LAND_MASK | 1
    }

    fn tile(map: &GameMapStore, x: u32, y: u32) -> TileRef {
        map.tile_ref(Coord::new(x, y)).unwrap()
    }

    #[test]
    fn diagonal_neighbors_match_game_map_order() {
        let map = GameMapStore::new(3, 3, vec![land(); 9]).unwrap();
        let center = map.neighbors8(tile(&map, 1, 1)).unwrap();
        let corner = map.neighbors8(tile(&map, 0, 0)).unwrap();

        assert_eq!(
            center.as_slice(),
            &[
                tile(&map, 0, 0),
                tile(&map, 0, 1),
                tile(&map, 0, 2),
                tile(&map, 1, 0),
                tile(&map, 1, 2),
                tile(&map, 2, 0),
                tile(&map, 2, 1),
                tile(&map, 2, 2),
            ]
        );
        assert_eq!(
            corner.as_slice(),
            &[tile(&map, 0, 1), tile(&map, 1, 0), tile(&map, 1, 1)]
        );
    }

    #[test]
    fn bfs_preserves_typescript_lifo_insertion_order() {
        let map = GameMapStore::new(3, 3, vec![land(); 9]).unwrap();
        let start = tile(&map, 1, 1);

        assert_eq!(
            map.bfs(start, |_, _| true).unwrap(),
            vec![
                tile(&map, 1, 1),
                tile(&map, 1, 0),
                tile(&map, 1, 2),
                tile(&map, 0, 1),
                tile(&map, 2, 1),
                tile(&map, 2, 0),
                tile(&map, 2, 2),
                tile(&map, 0, 0),
                tile(&map, 0, 2),
            ]
        );
    }

    #[test]
    fn bfs_filter_blocks_expansion_and_validates_the_start() {
        let mut map = GameMapStore::new(4, 1, vec![land(); 4]).unwrap();
        let first = tile(&map, 0, 0);
        let second = tile(&map, 1, 0);
        let barrier = tile(&map, 2, 0);
        let isolated = tile(&map, 3, 0);

        map.set_owner_id(first, 7).unwrap();
        map.set_owner_id(second, 7).unwrap();
        map.set_owner_id(barrier, 9).unwrap();
        map.set_owner_id(isolated, 7).unwrap();

        let connected = map
            .bfs(first, |map, tile| map.state(tile).unwrap().owner_id() == 7)
            .unwrap();
        assert_eq!(connected, vec![first, second]);
        assert_eq!(map.bfs(barrier, |_, _| false).unwrap(), Vec::new());

        let invalid = TileRef::new(map.tile_count());
        assert_eq!(
            map.bfs(invalid, |_, _| true),
            Err(GameMapError::InvalidTile { tile: invalid })
        );
    }

    #[test]
    fn owned_depths_matches_fifo_multi_source_search() {
        let mut map = GameMapStore::new(5, 3, vec![land(); 15]).unwrap();
        for tile in map.tiles().collect::<Vec<_>>() {
            map.set_owner_id(tile, 7).unwrap();
        }

        let left = tile(&map, 0, 1);
        let right = tile(&map, 4, 1);
        let actual = map.owned_depths(&[left, right, left], 7, 2).unwrap();
        let expected = vec![
            (left, 0),
            (right, 0),
            (tile(&map, 0, 0), 1),
            (tile(&map, 0, 2), 1),
            (tile(&map, 1, 1), 1),
            (tile(&map, 4, 0), 1),
            (tile(&map, 4, 2), 1),
            (tile(&map, 3, 1), 1),
            (tile(&map, 1, 0), 2),
            (tile(&map, 1, 2), 2),
            (tile(&map, 2, 1), 2),
            (tile(&map, 3, 0), 2),
            (tile(&map, 3, 2), 2),
        ];

        assert_eq!(actual, expected);
        assert_eq!(map.owned_depths(&[left], 7, 0).unwrap(), vec![(left, 0)]);
    }

    #[test]
    fn owned_depths_stops_at_owner_barriers_and_validates_sources() {
        let mut map = GameMapStore::new(4, 1, vec![land(); 4]).unwrap();
        let first = tile(&map, 0, 0);
        let second = tile(&map, 1, 0);
        let barrier = tile(&map, 2, 0);
        let isolated = tile(&map, 3, 0);
        map.set_owner_id(first, 7).unwrap();
        map.set_owner_id(second, 7).unwrap();
        map.set_owner_id(barrier, 9).unwrap();
        map.set_owner_id(isolated, 7).unwrap();

        assert_eq!(
            map.owned_depths(&[first], 7, 10).unwrap(),
            vec![(first, 0), (second, 1)]
        );

        let invalid = TileRef::new(map.tile_count());
        assert_eq!(
            map.owned_depths(&[invalid], 7, 1),
            Err(GameMapError::InvalidTile { tile: invalid })
        );
    }
}
