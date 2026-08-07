//! Bounded water A* matching `AStar.WaterBounded.ts`.

use crate::{GameMapError, GameMapStore, TileRef};

const COST_SCALE: u32 = 100;
const BASE_COST: u32 = COST_SCALE;
const DEFAULT_HEURISTIC_WEIGHT: u32 = 3;
const DEFAULT_MAX_ITERATIONS: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SearchBounds {
    pub min_x: u32,
    pub max_x: u32,
    pub min_y: u32,
    pub max_y: u32,
}

fn magnitude_penalty(magnitude: u8) -> u32 {
    if magnitude < 3 {
        3 * COST_SCALE
    } else if magnitude <= 10 {
        0
    } else {
        COST_SCALE
    }
}

#[derive(Debug, Clone, Copy)]
struct HeapEntry {
    node: u32,
    priority: u32,
}

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
pub struct BoundedWaterPathFinder {
    stamp: u32,
    closed_stamp: Vec<u32>,
    g_score_stamp: Vec<u32>,
    g_score: Vec<u32>,
    came_from: Vec<i32>,
    heap: MinHeap,
    heuristic_weight: u32,
    max_iterations: usize,
}

impl BoundedWaterPathFinder {
    #[must_use]
    pub fn new(max_search_area: usize) -> Self {
        Self {
            stamp: 1,
            closed_stamp: vec![0; max_search_area],
            g_score_stamp: vec![0; max_search_area],
            g_score: vec![0; max_search_area],
            came_from: vec![-1; max_search_area],
            heap: MinHeap::default(),
            heuristic_weight: DEFAULT_HEURISTIC_WEIGHT,
            max_iterations: DEFAULT_MAX_ITERATIONS,
        }
    }

    pub fn ensure_capacity(&mut self, max_search_area: usize) {
        if self.closed_stamp.len() >= max_search_area {
            return;
        }
        self.closed_stamp.resize(max_search_area, 0);
        self.g_score_stamp.resize(max_search_area, 0);
        self.g_score.resize(max_search_area, 0);
        self.came_from.resize(max_search_area, -1);
    }

    pub fn find_path(
        &mut self,
        map: &GameMapStore,
        starts: &[TileRef],
        goal: TileRef,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        if starts.is_empty() {
            return Ok(None);
        }
        let geometry = map.geometry();
        if !geometry.is_valid_ref(goal) {
            return Err(GameMapError::InvalidTile { tile: goal });
        }
        for start in starts {
            if !geometry.is_valid_ref(*start) {
                return Err(GameMapError::InvalidTile { tile: *start });
            }
        }

        let goal_coord = geometry.coord(goal).expect("validated goal");
        let mut bounds = SearchBounds {
            min_x: goal_coord.x,
            max_x: goal_coord.x,
            min_y: goal_coord.y,
            max_y: goal_coord.y,
        };
        for start in starts {
            let coord = geometry.coord(*start).expect("validated start");
            bounds.min_x = bounds.min_x.min(coord.x);
            bounds.max_x = bounds.max_x.max(coord.x);
            bounds.min_y = bounds.min_y.min(coord.y);
            bounds.max_y = bounds.max_y.max(coord.y);
        }
        self.search_bounded(map, starts, goal, bounds)
    }

    pub fn search_bounded(
        &mut self,
        map: &GameMapStore,
        starts: &[TileRef],
        goal: TileRef,
        bounds: SearchBounds,
    ) -> Result<Option<Vec<TileRef>>, GameMapError> {
        let geometry = map.geometry();
        if starts.is_empty() {
            return Ok(None);
        }
        if !geometry.is_valid_ref(goal) {
            return Err(GameMapError::InvalidTile { tile: goal });
        }
        for start in starts {
            if !geometry.is_valid_ref(*start) {
                return Err(GameMapError::InvalidTile { tile: *start });
            }
        }
        if bounds.min_x > bounds.max_x
            || bounds.min_y > bounds.max_y
            || bounds.max_x >= map.width()
            || bounds.max_y >= map.height()
        {
            return Ok(None);
        }

        let bounds_width = bounds.max_x - bounds.min_x + 1;
        let bounds_height = bounds.max_y - bounds.min_y + 1;
        let num_local_nodes = usize::try_from(bounds_width)
            .ok()
            .and_then(|w| usize::try_from(bounds_height).ok().and_then(|h| w.checked_mul(h)))
            .unwrap_or(usize::MAX);
        if num_local_nodes > self.closed_stamp.len() {
            return Ok(None);
        }

        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.closed_stamp.fill(0);
            self.g_score_stamp.fill(0);
            self.stamp = 1;
        }
        let stamp = self.stamp;
        self.heap.clear();

        let map_width = map.width();
        let terrain = map.terrain_buffer();
        let goal_x = goal.get() % map_width;
        let goal_y = goal.get() / map_width;

        let to_local = |tile: TileRef, clamp: bool| -> i64 {
            let mut x = tile.get() % map_width;
            let mut y = tile.get() / map_width;
            if clamp {
                x = x.clamp(bounds.min_x, bounds.max_x);
                y = y.clamp(bounds.min_y, bounds.max_y);
            }
            i64::from(y) - i64::from(bounds.min_y)
                * i64::from(bounds_width)
                + i64::from(x)
                - i64::from(bounds.min_x)
        };
        let to_global = |local: u32| -> TileRef {
            let local_x = local % bounds_width;
            let local_y = local / bounds_width;
            TileRef::new(
                (local_y + bounds.min_y) * map_width + (local_x + bounds.min_x),
            )
        };

        let goal_local = to_local(goal, true);
        if goal_local < 0 || goal_local as usize >= num_local_nodes {
            return Ok(None);
        }
        let goal_local = goal_local as u32;

        let first = starts[0];
        let start_x = first.get() % map_width;
        let start_y = first.get() / map_width;
        let dx_goal = i64::from(goal_x) - i64::from(start_x);
        let dy_goal = i64::from(goal_y) - i64::from(start_y);
        let cross_norm = (dx_goal.unsigned_abs() + dy_goal.unsigned_abs()).max(1);
        let cross_tie = |nx: u32, ny: u32| -> u32 {
            let dx_n = i64::from(nx) - i64::from(goal_x);
            let dy_n = i64::from(ny) - i64::from(goal_y);
            let cross = (dx_goal * dy_n - dy_goal * dx_n).unsigned_abs();
            ((cross * u64::from(COST_SCALE - 1)) / cross_norm / cross_norm) as u32
        };

        for start in starts {
            let start_local = to_local(*start, true);
            if start_local < 0 || start_local as usize >= num_local_nodes {
                continue;
            }
            let start_local = start_local as usize;
            self.g_score[start_local] = 0;
            self.g_score_stamp[start_local] = stamp;
            self.came_from[start_local] = -1;
            let sx = start.get() % map_width;
            let sy = start.get() / map_width;
            let h = self.heuristic_weight
                * BASE_COST
                * (sx.abs_diff(goal_x) + sy.abs_diff(goal_y));
            self.heap.push(start_local as u32, h);
        }

        let mut iterations = self.max_iterations;
        while !self.heap.is_empty() {
            iterations = iterations.saturating_sub(1);
            if iterations == 0 {
                return Ok(None);
            }

            let current_local = self.heap.pop().expect("heap is not empty");
            let current_index = current_local as usize;
            if self.closed_stamp[current_index] == stamp {
                continue;
            }
            self.closed_stamp[current_index] = stamp;
            if current_local == goal_local {
                return Ok(Some(self.build_path(goal_local, &to_global, num_local_nodes)));
            }

            let current = to_global(current_local);
            let current_x = current.get() % map_width;
            let current_y = current.get() / map_width;
            let current_g = self.g_score[current_index];

            let mut visit = |neighbor: u32,
                             neighbor_local: u32,
                             nx: u32,
                             ny: u32,
                             this: &mut Self| {
                let local_index = neighbor_local as usize;
                if this.closed_stamp[local_index] == stamp {
                    return;
                }
                let neighbor_terrain = terrain[neighbor as usize];
                if neighbor != goal.get() && neighbor_terrain.is_land() {
                    return;
                }
                let tentative_g = current_g
                    + BASE_COST
                    + magnitude_penalty(neighbor_terrain.magnitude());
                if this.g_score_stamp[local_index] != stamp
                    || tentative_g < this.g_score[local_index]
                {
                    this.came_from[local_index] = current_local as i32;
                    this.g_score[local_index] = tentative_g;
                    this.g_score_stamp[local_index] = stamp;
                    let h = this.heuristic_weight
                        * BASE_COST
                        * (nx.abs_diff(goal_x) + ny.abs_diff(goal_y));
                    this.heap
                        .push(neighbor_local, tentative_g + h + cross_tie(nx, ny));
                }
            };

            if current_y > bounds.min_y {
                visit(
                    current.get() - map_width,
                    current_local - bounds_width,
                    current_x,
                    current_y - 1,
                    self,
                );
            }
            if current_y < bounds.max_y {
                visit(
                    current.get() + map_width,
                    current_local + bounds_width,
                    current_x,
                    current_y + 1,
                    self,
                );
            }
            if current_x > bounds.min_x {
                visit(
                    current.get() - 1,
                    current_local - 1,
                    current_x - 1,
                    current_y,
                    self,
                );
            }
            if current_x < bounds.max_x {
                visit(
                    current.get() + 1,
                    current_local + 1,
                    current_x + 1,
                    current_y,
                    self,
                );
            }
        }

        Ok(None)
    }

    fn build_path(
        &self,
        goal_local: u32,
        to_global: &impl Fn(u32) -> TileRef,
        max_path_length: usize,
    ) -> Vec<TileRef> {
        let mut path = Vec::new();
        let mut current = goal_local as i32;
        let mut iterations = 0usize;
        while current != -1 && iterations < max_path_length {
            path.push(to_global(current as u32));
            current = self.came_from[current as usize];
            iterations += 1;
        }
        path.reverse();
        path
    }
}
