//! Grid geometry matching `src/core/game/GameMap.ts`.
//!
//! Tile references are row-major and cardinal neighbors are emitted in the
//! simulation's existing north, south, west, east order.

/// A row-major tile index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(transparent)]
pub struct TileRef(u32);

impl TileRef {
    #[must_use]
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

/// An integer tile coordinate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Coord {
    pub x: u32,
    pub y: u32,
}

impl Coord {
    #[must_use]
    pub const fn new(x: u32, y: u32) -> Self {
        Self { x, y }
    }
}

/// Errors that prevent construction of a valid row-major grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GridError {
    ZeroWidth,
    ZeroHeight,
    TileCountOverflow,
}

/// A fixed-capacity cardinal-neighbor result with no heap allocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NeighborRefs {
    refs: [TileRef; 4],
    len: u8,
}

impl NeighborRefs {
    const fn empty() -> Self {
        Self {
            refs: [TileRef::new(0); 4],
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

impl<'a> IntoIterator for &'a NeighborRefs {
    type Item = &'a TileRef;
    type IntoIter = core::slice::Iter<'a, TileRef>;

    fn into_iter(self) -> Self::IntoIter {
        self.as_slice().iter()
    }
}

/// Immutable geometry for a rectangular row-major tile grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GridGeometry {
    width: u32,
    height: u32,
    tile_count: u32,
}

impl GridGeometry {
    pub fn new(width: u32, height: u32) -> Result<Self, GridError> {
        if width == 0 {
            return Err(GridError::ZeroWidth);
        }
        if height == 0 {
            return Err(GridError::ZeroHeight);
        }
        let tile_count = width
            .checked_mul(height)
            .ok_or(GridError::TileCountOverflow)?;
        Ok(Self {
            width,
            height,
            tile_count,
        })
    }

    #[must_use]
    pub const fn width(self) -> u32 {
        self.width
    }

    #[must_use]
    pub const fn height(self) -> u32 {
        self.height
    }

    #[must_use]
    pub const fn tile_count(self) -> u32 {
        self.tile_count
    }

    #[must_use]
    pub const fn is_valid_coord(self, coord: Coord) -> bool {
        coord.x < self.width && coord.y < self.height
    }

    #[must_use]
    pub const fn is_valid_ref(self, tile: TileRef) -> bool {
        tile.0 < self.tile_count
    }

    /// Converts a coordinate to the same row-major reference used by GameMap.
    #[must_use]
    pub const fn tile_ref(self, coord: Coord) -> Option<TileRef> {
        if !self.is_valid_coord(coord) {
            return None;
        }
        Some(TileRef::new(coord.y * self.width + coord.x))
    }

    /// Converts a valid row-major tile reference back to coordinates.
    #[must_use]
    pub const fn coord(self, tile: TileRef) -> Option<Coord> {
        if !self.is_valid_ref(tile) {
            return None;
        }
        Some(Coord::new(tile.0 % self.width, tile.0 / self.width))
    }

    /// Returns cardinal neighbors in north, south, west, east order.
    #[must_use]
    pub fn neighbors4(self, tile: TileRef) -> Option<NeighborRefs> {
        let coord = self.coord(tile)?;
        let mut neighbors = NeighborRefs::empty();

        if coord.y > 0 {
            neighbors.push(TileRef::new(tile.0 - self.width));
        }
        if coord.y + 1 < self.height {
            neighbors.push(TileRef::new(tile.0 + self.width));
        }
        if coord.x > 0 {
            neighbors.push(TileRef::new(tile.0 - 1));
        }
        if coord.x + 1 < self.width {
            neighbors.push(TileRef::new(tile.0 + 1));
        }

        Some(neighbors)
    }

    #[must_use]
    pub fn manhattan_distance(self, a: TileRef, b: TileRef) -> Option<u32> {
        let a = self.coord(a)?;
        let b = self.coord(b)?;
        Some(a.x.abs_diff(b.x) + a.y.abs_diff(b.y))
    }

    #[must_use]
    pub fn euclidean_distance_squared(self, a: TileRef, b: TileRef) -> Option<u64> {
        let a = self.coord(a)?;
        let b = self.coord(b)?;
        let dx = u64::from(a.x.abs_diff(b.x));
        let dy = u64::from(a.y.abs_diff(b.y));
        Some(dx * dx + dy * dy)
    }

    /// Returns every tile inside a circle in GameMap's x-major scan order.
    #[must_use]
    pub fn circle(self, center: TileRef, radius: u32) -> Option<Vec<TileRef>> {
        let center_coord = self.coord(center)?;
        let min_x = center_coord.x.saturating_sub(radius);
        let max_x = center_coord.x.saturating_add(radius).min(self.width - 1);
        let min_y = center_coord.y.saturating_sub(radius);
        let max_y = center_coord.y.saturating_add(radius).min(self.height - 1);
        let radius_squared = u64::from(radius) * u64::from(radius);
        let mut tiles = Vec::new();

        for x in min_x..=max_x {
            for y in min_y..=max_y {
                let dx = u64::from(center_coord.x.abs_diff(x));
                let dy = u64::from(center_coord.y.abs_diff(y));
                if dx * dx + dy * dy <= radius_squared {
                    tiles.push(TileRef::new(y * self.width + x));
                }
            }
        }

        Some(tiles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(width: u32, height: u32) -> GridGeometry {
        GridGeometry::new(width, height).expect("test dimensions are valid")
    }

    fn tile(grid: GridGeometry, x: u32, y: u32) -> TileRef {
        grid.tile_ref(Coord::new(x, y))
            .expect("test coordinate is valid")
    }

    #[test]
    fn rejects_invalid_dimensions() {
        assert_eq!(GridGeometry::new(0, 1), Err(GridError::ZeroWidth));
        assert_eq!(GridGeometry::new(1, 0), Err(GridError::ZeroHeight));
        assert_eq!(
            GridGeometry::new(u32::MAX, 2),
            Err(GridError::TileCountOverflow)
        );
    }

    #[test]
    fn coordinates_round_trip_through_row_major_refs() {
        let grid = grid(4, 3);
        let expected = TileRef::new(9);

        assert_eq!(grid.tile_ref(Coord::new(1, 2)), Some(expected));
        assert_eq!(grid.coord(expected), Some(Coord::new(1, 2)));
        assert_eq!(grid.tile_ref(Coord::new(4, 2)), None);
        assert_eq!(grid.coord(TileRef::new(12)), None);
    }

    #[test]
    fn cardinal_neighbors_match_game_map_order() {
        let grid = grid(4, 3);
        let center = grid.neighbors4(tile(grid, 1, 1)).unwrap();
        let corner = grid.neighbors4(tile(grid, 0, 0)).unwrap();

        assert_eq!(
            center.as_slice(),
            &[
                tile(grid, 1, 0),
                tile(grid, 1, 2),
                tile(grid, 0, 1),
                tile(grid, 2, 1),
            ]
        );
        assert_eq!(corner.as_slice(), &[tile(grid, 0, 1), tile(grid, 1, 0)]);
    }

    #[test]
    fn distance_calculations_match_game_map() {
        let grid = grid(4, 3);
        let start = tile(grid, 0, 0);
        let end = tile(grid, 3, 2);

        assert_eq!(grid.manhattan_distance(start, end), Some(5));
        assert_eq!(grid.euclidean_distance_squared(start, end), Some(13));
    }

    #[test]
    fn circle_matches_game_map_scan_order() {
        let grid = grid(3, 3);
        let center = tile(grid, 1, 1);

        assert_eq!(
            grid.circle(center, 1).unwrap(),
            vec![
                tile(grid, 0, 1),
                tile(grid, 1, 0),
                tile(grid, 1, 1),
                tile(grid, 1, 2),
                tile(grid, 2, 1),
            ]
        );
    }
}
