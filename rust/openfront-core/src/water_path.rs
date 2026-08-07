//! Water A* matching `src/core/pathfinding/algorithms/AStar.Water.ts`.

use crate::{GameMapError, GameMapStore, TileRef};

const COST_SCALE: u32 = 100;
const BASE_COST: u32 = COST_SCALE;
const DEFAULT_HEURISTIC_WEIGHT: u32 = 5;
const DEFAULT_MAX_ITERATIONS: usize = 1_000_000;

fn magnitude_penalty(magnitude: u8) -> u32 {
    if magnitude < 3 {
        10 * COST_SCALE
    } else if magnitude <= 10 {
        0
    } else {
        COST_SCALE
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HeapEntry {
    node: u32,
    priority: u32,
}

/// Binary min-heap with the same priority-only tie behavior as TypeScript's
/// `MinHeap`: equal priorities never swap during bubble-up or bubble-down.
#[derive(Debug, Default)]
struct MinHeap {
    entries: Vec<HeapEntry>,
}

impl MinHeap {
    fn clear(&mut self) {
        self.entries.clear();
    }

    fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn push(&mut self, node: u32, priority: u32) {
        let mut index = self.entries.len();
        self.entries.push(HeapEntry { node, priority });
        while index > 0 {
            let parent = (index - 1) >> 1;
            if self.entries[parent].priority <= self.entries[index].priority {
                break;
            }
            self.entries.swap(parent, index);
            index = parent;
        }
    }

    fn pop(&mut self) -> Option<u32> {
        if self.entries.is_empty() {
            return None;
        }
        let result = self.entries[0].node;
        let last = self.entries.pop().expect("heap was non-empty");
        if !self.entries.is_empty() {
            self.entries[0] = last;
            let mut index = 0;
            loop {
                let left = (index << 1) + 1;
                let right = left + 1;
                let mut smallest = index;
                if left < self.entries.len()
                    && self.entries[left].priority < self.entries[smallest].priority
                {
                    smallest = left;
                }
                if right < self.entries.len()
                    && self.entries[right].priority < self.entries[smallest].priority
                {
                    smallest = right;
                }
                if smallest == index {
                    break;
                }
                self.entries.swap(smallest, index);
                index = smallest;
            }
        }
        Some(result)
    }
}

#[derive(Debug)]
pub struct WaterPathFinder {
    stamp: u32,
    closed_stamp: Vec<u32>,
    g_score_stamp: Vec<u32>,
    g_score: Vec<u32>,
    came_from: Vec<i32>,
    heap: MinHeap,
    heuristic_weight: u32,
    max_iterations: usize,
}

impl WaterPathFinder {
    #[must_use]
    pub fn new(tile_count: usize) -> Self {
        Self {
            stamp: 1,
            closed_stamp: vec![0; tile_count],
            g_score_stamp: vec![0; tile_count],
            g_score: vec![0; tile_count],
            came_from: vec![-1; tile_count],
            heap: MinHeap::default(),
            heuristic_weight: DEFAULT_HEURISTIC_WEIGHT,
            max_iterations: DEFAULT_MAX_ITERATIONS,
        }
    }

    pub fn find_path(
        &mut self,
        map: &GameMapStore,
        starts: &[TileRef],
        goal: TileRef,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        let geometry = map.geometry();
        if starts.is_empty() || !geometry.is_valid_ref(goal) {
            return Ok(None);
        }
        for start in starts {
            if !geometry.is_valid_ref(*start) {
                return Err(GameMapError::InvalidTile { tile: *start });
            }
        }

        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.closed_stamp.fill(0);
            self.g_score_stamp.fill(0);
            self.stamp = 1;
        }
        let stamp = self.stamp;
        self.heap.clear();

        let width = map.width();
        let num_nodes = map.tile_count();
        let goal_coord = geometry.coord(goal).expect("validated goal");
        let first_coord = geometry.coord(starts[0]).expect("validated start");
        let dx_goal = i64::from(goal_coord.x) - i64::from(first_coord.x);
        let dy_goal = i64::from(goal_coord.y) - i64::from(first_coord.y);
        let cross_norm = (dx_goal.unsigned_abs() + dy_goal.unsigned_abs()).max(1);

        let cross_tie = |x: u32, y: u32| -> u32 {
            let dx_n = i64::from(x) - i64::from(goal_coord.x);
            let dy_n = i64::from(y) - i64::from(goal_coord.y);
            let cross = (dx_goal * dy_n - dy_goal * dx_n).unsigned_abs();
            ((cross * u64::from(COST_SCALE - 1)) / cross_norm / cross_norm) as u32
        };

        for start in starts {
            let index = start.get() as usize;
            self.g_score[index] = 0;
            self.g_score_stamp[index] = stamp;
            self.came_from[index] = -1;
            let coord = geometry.coord(*start).expect("validated start");
            let h = self.heuristic_weight
                * BASE_COST
                * (coord.x.abs_diff(goal_coord.x) + coord.y.abs_diff(goal_coord.y));
            self.heap.push(start.get(), h);
        }

        let mut iterations = self.max_iterations;
        while !self.heap.is_empty() {
            iterations = iterations.saturating_sub(1);
            if iterations == 0 {
                return Ok(None);
            }
            let current = self.heap.pop().expect("heap is not empty");
            let current_index = current as usize;
            if self.closed_stamp[current_index] == stamp {
                continue;
            }
            self.closed_stamp[current_index] = stamp;
            if current == goal.get() {
                return Ok(Some(self.build_path(goal)));
            }

            let current_ref = TileRef::new(current);
            let current_coord = geometry.coord(current_ref).expect("current is valid");
            let current_g = self.g_score[current_index];

            let mut visit = |neighbor: u32, nx: u32, ny: u32, this: &mut Self| -> Result<(), GameMapError> {
                let neighbor_index = neighbor as usize;
                if this.closed_stamp[neighbor_index] == stamp {
                    return Ok(());
                }
                let terrain = map.terrain(TileRef::new(neighbor))?;
                if neighbor != goal.get() && terrain.is_land() {
                    return Ok(());
                }
                let tentative_g = current_g + BASE_COST + magnitude_penalty(terrain.magnitude());
                if this.g_score_stamp[neighbor_index] != stamp
                    || tentative_g < this.g_score[neighbor_index]
                {
                    this.came_from[neighbor_index] = current as i32;
                    this.g_score[neighbor_index] = tentative_g;
                    this.g_score_stamp[neighbor_index] = stamp;
                    let h = this.heuristic_weight
                        * BASE_COST
                        * (nx.abs_diff(goal_coord.x) + ny.abs_diff(goal_coord.y));
                    this.heap.push(neighbor, tentative_g + h + cross_tie(nx, ny));
                }
                Ok(())
            };

            if current >= width {
                visit(current - width, current_coord.x, current_coord.y - 1, self)?;
            }
            if current < num_nodes - width {
                visit(current + width, current_coord.x, current_coord.y + 1, self)?;
            }
            if current_coord.x != 0 {
                visit(current - 1, current_coord.x - 1, current_coord.y, self)?;
            }
            if current_coord.x + 1 < width {
                visit(current + 1, current_coord.x + 1, current_coord.y, self)?;
            }
        }

        Ok(None)
    }

    fn build_path(&self, goal: TileRef) -> Vec<TileRef> {
        let mut path = Vec::new();
        let mut current = goal.get() as i32;
        while current != -1 {
            path.push(TileRef::new(current as u32));
            current = self.came_from[current as usize];
        }
        path.reverse();
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Coord, TERRAIN_LAND_MASK};

    #[test]
    fn routes_around_land_and_reaches_land_goal() {
        let width = 7;
        let height = 5;
        let mut terrain = vec![5_u8; (width * height) as usize];
        for y in 0..height {
            if y != 4 {
                terrain[(y * width + 3) as usize] = TERRAIN_LAND_MASK | 1;
            }
        }
        let map = GameMapStore::new(width, height, terrain).unwrap();
        let start = map.tile_ref(Coord::new(0, 2)).unwrap();
        let goal = map.tile_ref(Coord::new(6, 2)).unwrap();
        let mut finder = WaterPathFinder::new(map.tile_count() as usize);
        let path = finder.find_path(&map, &[start], goal).unwrap().unwrap();
        assert_eq!(path.first(), Some(&start));
        assert_eq!(path.last(), Some(&goal));
        for tile in path.iter().skip(1).take(path.len().saturating_sub(2)) {
            assert!(!map.terrain(*tile).unwrap().is_land());
        }
    }
}
