//! Rail A* matching `src/core/pathfinding/algorithms/AStar.Rail.ts`.

use crate::{GameMapError, GameMapStore, TileRef};

const WATER_PENALTY: u32 = 5;
const HEURISTIC_WEIGHT: u32 = 2;
const DIRECTION_CHANGE_PENALTY: u32 = 3;
const MAX_ITERATIONS: usize = 500_000;

fn heuristic(map: &GameMapStore, node: TileRef, goal: TileRef) -> Result<u32, GameMapError> {
    let n = map.coord(node)?;
    let g = map.coord(goal)?;
    Ok(HEURISTIC_WEIGHT * (n.x.abs_diff(g.x) + n.y.abs_diff(g.y)))
}

fn traversable(
    map: &GameMapStore,
    to: TileRef,
    from_shoreline: bool,
) -> Result<bool, GameMapError> {
    let terrain = map.terrain(to)?;
    if !terrain.is_water() {
        return Ok(true);
    }
    Ok(from_shoreline || terrain.is_shoreline())
}

fn edge_cost(
    map: &GameMapStore,
    from: TileRef,
    to: TileRef,
    prev: Option<TileRef>,
) -> Result<u32, GameMapError> {
    let terrain = map.terrain(to)?;
    let mut cost = if terrain.is_water() || terrain.is_shoreline() {
        1 + WATER_PENALTY
    } else {
        1
    };

    if let Some(prev) = prev {
        let d1 = i64::from(from.get()) - i64::from(prev.get());
        let d2 = i64::from(to.get()) - i64::from(from.get());
        if d1 != d2 {
            cost += DIRECTION_CHANGE_PENALTY;
        }
    }
    Ok(cost)
}

fn rail_neighbors(map: &GameMapStore, node: TileRef) -> Result<Vec<TileRef>, GameMapError> {
    let geometry = map.geometry();
    if !geometry.is_valid_ref(node) {
        return Err(GameMapError::InvalidTile { tile: node });
    }
    let coord = map.coord(node)?;
    let from_shoreline = map.terrain(node)?.is_shoreline();
    let mut output = Vec::with_capacity(4);

    if coord.y > 0 {
        let n = TileRef::new(node.get() - map.width());
        if traversable(map, n, from_shoreline)? {
            output.push(n);
        }
    }
    if coord.y + 1 < map.height() {
        let n = TileRef::new(node.get() + map.width());
        if traversable(map, n, from_shoreline)? {
            output.push(n);
        }
    }
    if coord.x > 0 {
        let n = TileRef::new(node.get() - 1);
        if traversable(map, n, from_shoreline)? {
            output.push(n);
        }
    }
    if coord.x + 1 < map.width() {
        let n = TileRef::new(node.get() + 1);
        if traversable(map, n, from_shoreline)? {
            output.push(n);
        }
    }
    Ok(output)
}

/// Finds the same rail route as the TypeScript generic A* + RailAdapter.
/// Equal-priority entries are popped LIFO, matching `BucketQueue` exactly.
pub fn rail_path(
    map: &GameMapStore,
    starts: &[TileRef],
    goal: TileRef,
) -> Result<Option<Vec<TileRef>>, GameMapError> {
    let geometry = map.geometry();
    if !geometry.is_valid_ref(goal) {
        return Err(GameMapError::InvalidTile { tile: goal });
    }
    for start in starts {
        if !geometry.is_valid_ref(*start) {
            return Err(GameMapError::InvalidTile { tile: *start });
        }
    }
    if starts.is_empty() {
        return Ok(None);
    }

    let node_count = map.tile_count() as usize;
    let max_cost = 1 + WATER_PENALTY + DIRECTION_CHANGE_PENALTY;
    let max_priority = HEURISTIC_WEIGHT * (map.width() + map.height()) * max_cost;
    let mut buckets: Vec<Vec<u32>> = (0..=max_priority).map(|_| Vec::new()).collect();
    let mut min_bucket = buckets.len();
    let mut queue_size = 0usize;
    let mut closed = vec![false; node_count];
    let mut g_score = vec![u32::MAX; node_count];
    let mut came_from = vec![-1_i32; node_count];

    let push = |buckets: &mut Vec<Vec<u32>>,
                min_bucket: &mut usize,
                queue_size: &mut usize,
                node: u32,
                priority: u32| {
        let bucket = (priority as usize).min(buckets.len() - 1);
        buckets[bucket].push(node);
        *queue_size += 1;
        if bucket < *min_bucket {
            *min_bucket = bucket;
        }
    };

    for start in starts {
        let index = start.get() as usize;
        g_score[index] = 0;
        came_from[index] = -1;
        push(
            &mut buckets,
            &mut min_bucket,
            &mut queue_size,
            start.get(),
            heuristic(map, *start, goal)?,
        );
    }

    let mut iterations = MAX_ITERATIONS;
    while queue_size > 0 {
        if iterations == 0 {
            return Ok(None);
        }
        iterations -= 1;

        while min_bucket < buckets.len() && buckets[min_bucket].is_empty() {
            min_bucket += 1;
        }
        if min_bucket >= buckets.len() {
            break;
        }
        let current = TileRef::new(buckets[min_bucket].pop().expect("non-empty bucket"));
        queue_size -= 1;
        let current_index = current.get() as usize;
        if closed[current_index] {
            continue;
        }
        closed[current_index] = true;

        if current == goal {
            let mut path = Vec::new();
            let mut cursor = goal.get() as i32;
            while cursor != -1 {
                path.push(TileRef::new(cursor as u32));
                cursor = came_from[cursor as usize];
            }
            path.reverse();
            return Ok(Some(path));
        }

        let current_g = g_score[current_index];
        let prev = if came_from[current_index] == -1 {
            None
        } else {
            Some(TileRef::new(came_from[current_index] as u32))
        };
        for neighbor in rail_neighbors(map, current)? {
            let neighbor_index = neighbor.get() as usize;
            if closed[neighbor_index] {
                continue;
            }
            let tentative = current_g + edge_cost(map, current, neighbor, prev)?;
            if tentative < g_score[neighbor_index] {
                came_from[neighbor_index] = current.get() as i32;
                g_score[neighbor_index] = tentative;
                let priority = tentative + heuristic(map, neighbor, goal)?;
                push(
                    &mut buckets,
                    &mut min_bucket,
                    &mut queue_size,
                    neighbor.get(),
                    priority,
                );
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Coord, TERRAIN_LAND_MASK, TERRAIN_SHORELINE_MASK};

    fn tile(map: &GameMapStore, x: u32, y: u32) -> TileRef {
        map.tile_ref(Coord::new(x, y)).unwrap()
    }

    #[test]
    fn finds_land_route() {
        let map = GameMapStore::new(5, 5, vec![TERRAIN_LAND_MASK | 1; 25]).unwrap();
        let path = rail_path(&map, &[tile(&map, 0, 0)], tile(&map, 4, 4))
            .unwrap()
            .unwrap();
        assert_eq!(path.first(), Some(&tile(&map, 0, 0)));
        assert_eq!(path.last(), Some(&tile(&map, 4, 4)));
        assert_eq!(path.len(), 9);
    }

    #[test]
    fn shoreline_can_enter_water_but_open_water_cannot_continue() {
        let mut terrain = vec![TERRAIN_LAND_MASK | 1; 5];
        terrain[1] = TERRAIN_LAND_MASK | TERRAIN_SHORELINE_MASK | 1;
        terrain[2] = TERRAIN_SHORELINE_MASK;
        terrain[3] = 0;
        let map = GameMapStore::new(5, 1, terrain).unwrap();
        assert!(rail_path(&map, &[tile(&map, 0, 0)], tile(&map, 4, 0))
            .unwrap()
            .is_none());
    }
}
