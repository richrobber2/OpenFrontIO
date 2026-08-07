//! Air-path generation matching `src/core/pathfinding/PathFinder.Air.ts`.

use crate::{Coord, GridGeometry, PseudoRandom, TileRef};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AirPathError {
    InvalidFrom,
    InvalidTo,
}

pub fn air_path(
    geometry: GridGeometry,
    from: TileRef,
    to: TileRef,
    seed: i32,
) -> Result<Vec<TileRef>, AirPathError> {
    if !geometry.is_valid_ref(from) {
        return Err(AirPathError::InvalidFrom);
    }
    if !geometry.is_valid_ref(to) {
        return Err(AirPathError::InvalidTo);
    }

    let destination = geometry.coord(to).expect("validated destination");
    let mut random = PseudoRandom::new(seed);
    let mut path = vec![from];
    let mut current = from;

    while current != to {
        let coord = geometry.coord(current).expect("path stays on grid");
        let dx = i64::from(destination.x) - i64::from(coord.x);
        let dy = i64::from(destination.y) - i64::from(coord.y);
        let ratio = 1 + (dy.unsigned_abs() / (dx.unsigned_abs() + 1)) as i32;

        let (next_x, next_y) = if dx == 0 {
            (i64::from(coord.x), i64::from(coord.y) + dy.signum())
        } else if dy == 0 {
            (i64::from(coord.x) + dx.signum(), i64::from(coord.y))
        } else if random.chance(ratio) {
            (i64::from(coord.x) + dx.signum(), i64::from(coord.y))
        } else {
            (i64::from(coord.x), i64::from(coord.y) + dy.signum())
        };

        let next = geometry
            .tile_ref(Coord::new(next_x as u32, next_y as u32))
            .expect("air path moves one step toward an in-bounds destination");
        if next == current {
            break;
        }
        current = next;
        path.push(current);
    }

    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_reaches_destination_and_moves_cardinally() {
        let geometry = GridGeometry::new(8, 8).unwrap();
        let from = geometry.tile_ref(Coord::new(1, 1)).unwrap();
        let to = geometry.tile_ref(Coord::new(6, 5)).unwrap();
        let path = air_path(geometry, from, to, 42).unwrap();
        assert_eq!(path.first(), Some(&from));
        assert_eq!(path.last(), Some(&to));
        assert_eq!(path.len(), 10);
        for pair in path.windows(2) {
            assert_eq!(geometry.manhattan_distance(pair[0], pair[1]), Some(1));
        }
    }

    #[test]
    fn same_seed_produces_same_route() {
        let geometry = GridGeometry::new(12, 12).unwrap();
        let from = geometry.tile_ref(Coord::new(0, 11)).unwrap();
        let to = geometry.tile_ref(Coord::new(11, 0)).unwrap();
        assert_eq!(
            air_path(geometry, from, to, 9001),
            air_path(geometry, from, to, 9001),
        );
    }
}
