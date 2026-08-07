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

#[derive(Debug)]
pub struct RailPathFinder {
    stamp: u32,
    closed_stamp: Vec<u32>,
    g_score_stamp: Vec<u32>,
    g_score: Vec<u32>,
    came_from: Vec<i32>,
    buckets: Vec<Vec<u32>>,
    active_buckets: Vec<usize>,
    min_bucket: usize,
    queue_size: usize,
}

impl RailPathFinder {
    #[must_use]
    pub fn new(width: u32, height: u32) -> Self {
        let node_count = width.saturating_mul(height) as usize;
        let max_cost = 1 + WATER_PENALTY + DIRECTION_CHANGE_PENALTY;
        let max_priority = HEURISTIC_WEIGHT * (width + height) * max_cost;
        let bucket_count = max_priority as usize + 1;
        Self {
            stamp: 1,
            closed_stamp: vec![0; node_count],
            g_score_stamp: vec![0; node_count],
            g_score: vec![0; node_count],
            came_from: vec![-1; node_count],
            buckets: (0..bucket_count).map(|_| Vec::new()).collect(),
            active_buckets: Vec::new(),
            min_bucket: bucket_count,
            queue_size: 0,
        }
    }

    fn reset_queue(&mut self) {
        for bucket in self.active_buckets.drain(..) {
            self.buckets[bucket].clear();
        }
        self.min_bucket = self.buckets.len();
        self.queue_size = 0;
    }

    fn push(&mut self, node: u32, priority: u32) {
        let bucket = (priority as usize).min(self.buckets.len() - 1);
        if self.buckets[bucket].is_empty() {
            self.active_buckets.push(bucket);
        }
        self.buckets[bucket].push(node);
        self.queue_size += 1;
        if bucket < self.min_bucket {
            self.min_bucket = bucket;
        }
    }

    fn pop(&mut self) -> Option<u32> {
        while self.min_bucket < self.buckets.len() && self.buckets[self.min_bucket].is_empty() {
            self.min_bucket += 1;
        }
        if self.min_bucket >= self.buckets.len() {
            return None;
        }
        self.queue_size -= 1;
        self.buckets[self.min_bucket].pop()
    }

    fn build_path(&self, goal: TileRef) -> Vec<TileRef> {
        let mut path = Vec::new();
        let mut cursor = goal.get() as i32;
        while cursor != -1 {
            path.push(TileRef::new(cursor as u32));
            cursor = self.came_from[cursor as usize];
        }
        path.reverse();
        path
    }

    pub fn find_path(
        &mut self,
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

        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.closed_stamp.fill(0);
            self.g_score_stamp.fill(0);
            self.stamp = 1;
        }
        let stamp = self.stamp;
        self.reset_queue();

        for start in starts {
            let index = start.get() as usize;
            self.g_score[index] = 0;
            self.g_score_stamp[index] = stamp;
            self.came_from[index] = -1;
            self.push(start.get(), heuristic(map, *start, goal)?);
        }

        let width = map.width();
        let height = map.height();
        let mut iterations = MAX_ITERATIONS;
        while self.queue_size > 0 {
            if iterations == 0 {
                return Ok(None);
            }
            iterations -= 1;

            let Some(current_raw) = self.pop() else {
                break;
            };
            let current = TileRef::new(current_raw);
            let current_index = current_raw as usize;
            if self.closed_stamp[current_index] == stamp {
                continue;
            }
            self.closed_stamp[current_index] = stamp;

            if current == goal {
                return Ok(Some(self.build_path(goal)));
            }

            let current_g = self.g_score[current_index];
            let prev = if self.came_from[current_index] == -1 {
                None
            } else {
                Some(TileRef::new(self.came_from[current_index] as u32))
            };
            let coord = map.coord(current)?;
            let from_shoreline = map.terrain(current)?.is_shoreline();
            let mut neighbors = [TileRef::new(0); 4];
            let mut count = 0usize;

            if coord.y > 0 {
                let n = TileRef::new(current_raw - width);
                if traversable(map, n, from_shoreline)? {
                    neighbors[count] = n;
                    count += 1;
                }
            }
            if coord.y + 1 < height {
                let n = TileRef::new(current_raw + width);
                if traversable(map, n, from_shoreline)? {
                    neighbors[count] = n;
                    count += 1;
                }
            }
            if coord.x > 0 {
                let n = TileRef::new(current_raw - 1);
                if traversable(map, n, from_shoreline)? {
                    neighbors[count] = n;
                    count += 1;
                }
            }
            if coord.x + 1 < width {
                let n = TileRef::new(current_raw + 1);
                if traversable(map, n, from_shoreline)? {
                    neighbors[count] = n;
                    count += 1;
                }
            }

            for neighbor in &neighbors[..count] {
                let neighbor_index = neighbor.get() as usize;
                if self.closed_stamp[neighbor_index] == stamp {
                    continue;
                }
                let tentative = current_g + edge_cost(map, current, *neighbor, prev)?;
                if self.g_score_stamp[neighbor_index] != stamp
                    || tentative < self.g_score[neighbor_index]
                {
                    self.came_from[neighbor_index] = current_raw as i32;
                    self.g_score[neighbor_index] = tentative;
                    self.g_score_stamp[neighbor_index] = stamp;
                    let priority = tentative + heuristic(map, *neighbor, goal)?;
                    self.push(neighbor.get(), priority);
                }
            }
        }

        Ok(None)
    }
}

/// Compatibility wrapper for callers that do not retain a pathfinder.
pub fn rail_path(
    map: &GameMapStore,
    starts: &[TileRef],
    goal: TileRef,
) -> Result<Option<Vec<TileRef>>, GameMapError> {
    RailPathFinder::new(map.width(), map.height()).find_path(map, starts, goal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Coord, TERRAIN_LAND_MASK, TERRAIN_SHORELINE_MASK};

    fn tile(map: &GameMapStore, x: u32, y: u32) -> TileRef {
        map.tile_ref(Coord::new(x, y)).unwrap()
    }

    #[test]
    fn finds_land_route_and_reuses_scratch() {
        let map = GameMapStore::new(5, 5, vec![TERRAIN_LAND_MASK | 1; 25]).unwrap();
        let start = tile(&map, 0, 0);
        let goal = tile(&map, 4, 4);
        let mut finder = RailPathFinder::new(map.width(), map.height());
        let first = finder.find_path(&map, &[start], goal).unwrap().unwrap();
        let second = finder.find_path(&map, &[start], goal).unwrap().unwrap();
        assert_eq!(first, second);
        assert_eq!(first.first(), Some(&start));
        assert_eq!(first.last(), Some(&goal));
        assert_eq!(first.len(), 9);
    }

    #[test]
    fn shoreline_can_enter_one_open_water_tile_but_not_continue() {
        let mut terrain = vec![TERRAIN_LAND_MASK | 1; 6];
        terrain[1] = TERRAIN_LAND_MASK | TERRAIN_SHORELINE_MASK | 1;
        terrain[2] = 0;
        terrain[3] = 0;
        terrain[4] = TERRAIN_SHORELINE_MASK;
        let map = GameMapStore::new(6, 1, terrain).unwrap();
        assert!(rail_path(&map, &[tile(&map, 0, 0)], tile(&map, 5, 0))
            .unwrap()
            .is_none());
    }
}
