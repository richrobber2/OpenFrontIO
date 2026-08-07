use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefensePoint {
    pub x: u32,
    pub y: u32,
}

impl DefensePoint {
    pub const fn new(x: u32, y: u32) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefensePathPoint {
    pub x: u32,
    pub y: u32,
    pub blocked: bool,
}

impl DefensePathPoint {
    pub const fn new(x: u32, y: u32, blocked: bool) -> Self {
        Self { x, y, blocked }
    }

    const fn point(self) -> DefensePoint {
        DefensePoint::new(self.x, self.y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Defense {
    pub id: u32,
    pub x: u32,
    pub y: u32,
    pub range: u32,
    pub available_interceptions: u32,
}

impl Defense {
    pub const fn new(id: u32, x: u32, y: u32, range: u32, available_interceptions: u32) -> Self {
        Self {
            id,
            x,
            y,
            range,
            available_interceptions,
        }
    }

    const fn point(self) -> DefensePoint {
        DefensePoint::new(self.x, self.y)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DefensePathAssessment {
    pub blocked: bool,
    pub intercepting_defenses: u32,
    pub interception_capacity: u32,
}

/// Persistent spatial index for circular defensive coverage.
///
/// Each defense is registered in every grid bucket touched by its coverage
/// bounding box. Route queries therefore inspect only the defenses that could
/// cover each targetable path point rather than rescanning the full defense
/// list for every point.
#[derive(Debug, Clone)]
pub struct DefenseIndex {
    cell_size: u32,
    defenses: Vec<Defense>,
    buckets: HashMap<(u32, u32), Vec<usize>>,
}

impl DefenseIndex {
    pub fn new(cell_size: u32) -> Option<Self> {
        if cell_size == 0 {
            return None;
        }
        Some(Self {
            cell_size,
            defenses: Vec::new(),
            buckets: HashMap::new(),
        })
    }

    pub const fn cell_size(&self) -> u32 {
        self.cell_size
    }

    pub fn len(&self) -> usize {
        self.defenses.len()
    }

    pub fn is_empty(&self) -> bool {
        self.defenses.is_empty()
    }

    /// Replace all indexed defenses. Duplicate IDs use the last supplied
    /// record so stale unit snapshots cannot double-count interception capacity.
    pub fn replace(&mut self, defenses: impl IntoIterator<Item = Defense>) {
        self.defenses.clear();
        self.buckets.clear();

        let mut indices_by_id = HashMap::<u32, usize>::new();
        for defense in defenses {
            if let Some(&index) = indices_by_id.get(&defense.id) {
                self.defenses[index] = defense;
            } else {
                let index = self.defenses.len();
                indices_by_id.insert(defense.id, index);
                self.defenses.push(defense);
            }
        }

        for index in 0..self.defenses.len() {
            let defense = self.defenses[index];
            self.index_defense(index, defense);
        }
    }

    /// Assess an engine-produced route using the same targetability semantics
    /// as the TypeScript strategic-weapons policy: blocked points abort the
    /// route, and SAM coverage only matters while the path point lies strictly
    /// inside the source or destination targetable radius.
    pub fn assess_path(
        &self,
        path: impl IntoIterator<Item = DefensePathPoint>,
        source: DefensePoint,
        destination: DefensePoint,
        targetable_range: u32,
    ) -> DefensePathAssessment {
        let targetable_range_squared = square(targetable_range);
        let mut intercepting = HashMap::<u32, u32>::new();

        for path_point in path {
            if path_point.blocked {
                return assessment(true, &intercepting);
            }

            let point = path_point.point();
            let targetable = distance_squared(point, source) < targetable_range_squared
                || distance_squared(point, destination) < targetable_range_squared;
            if !targetable {
                continue;
            }

            let bucket = (point.x / self.cell_size, point.y / self.cell_size);
            let Some(indices) = self.buckets.get(&bucket) else {
                continue;
            };

            for &index in indices {
                let defense = self.defenses[index];
                if defense.available_interceptions == 0 {
                    continue;
                }
                if distance_squared(point, defense.point()) <= square(defense.range) {
                    intercepting
                        .entry(defense.id)
                        .or_insert(defense.available_interceptions);
                }
            }
        }

        assessment(false, &intercepting)
    }

    fn index_defense(&mut self, index: usize, defense: Defense) {
        let min_x = defense.x.saturating_sub(defense.range) / self.cell_size;
        let max_x = defense.x.saturating_add(defense.range) / self.cell_size;
        let min_y = defense.y.saturating_sub(defense.range) / self.cell_size;
        let max_y = defense.y.saturating_add(defense.range) / self.cell_size;

        for cell_y in min_y..=max_y {
            for cell_x in min_x..=max_x {
                self.buckets
                    .entry((cell_x, cell_y))
                    .or_default()
                    .push(index);
            }
        }
    }
}

fn assessment(blocked: bool, intercepting: &HashMap<u32, u32>) -> DefensePathAssessment {
    DefensePathAssessment {
        blocked,
        intercepting_defenses: intercepting.len() as u32,
        interception_capacity: intercepting
            .values()
            .copied()
            .fold(0_u32, u32::saturating_add),
    }
}

fn square(value: u32) -> u64 {
    let value = u64::from(value);
    value.saturating_mul(value)
}

fn distance_squared(a: DefensePoint, b: DefensePoint) -> u64 {
    let dx = u64::from(a.x.abs_diff(b.x));
    let dy = u64::from(a.y.abs_diff(b.y));
    dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_path(start: u32, end: u32, y: u32) -> Vec<DefensePathPoint> {
        (start..=end)
            .map(|x| DefensePathPoint::new(x, y, false))
            .collect()
    }

    #[test]
    fn indexes_normal_and_upgraded_interception_capacity() {
        let mut index = DefenseIndex::new(4).unwrap();
        index.replace([
            Defense::new(10, 4, 1, 2, 1),
            Defense::new(20, 16, 0, 2, 3),
            Defense::new(30, 10, 0, 2, 9),
        ]);

        let result = index.assess_path(
            line_path(0, 20, 0),
            DefensePoint::new(0, 0),
            DefensePoint::new(20, 0),
            8,
        );

        assert_eq!(
            result,
            DefensePathAssessment {
                blocked: false,
                intercepting_defenses: 2,
                interception_capacity: 4,
            }
        );
    }

    #[test]
    fn circle_boundary_counts_but_targetable_boundary_does_not() {
        let mut index = DefenseIndex::new(8).unwrap();
        index.replace([Defense::new(1, 4, 3, 3, 2)]);

        let covered = index.assess_path(
            [DefensePathPoint::new(4, 0, false)],
            DefensePoint::new(0, 0),
            DefensePoint::new(100, 0),
            5,
        );
        assert_eq!(covered.interception_capacity, 2);

        let not_targetable = index.assess_path(
            [DefensePathPoint::new(5, 0, false)],
            DefensePoint::new(0, 0),
            DefensePoint::new(100, 0),
            5,
        );
        assert_eq!(not_targetable.interception_capacity, 0);
    }

    #[test]
    fn blocked_path_returns_interceptions_seen_before_block() {
        let mut index = DefenseIndex::new(4).unwrap();
        index.replace([Defense::new(7, 1, 0, 1, 3)]);

        let result = index.assess_path(
            [
                DefensePathPoint::new(0, 0, false),
                DefensePathPoint::new(1, 0, false),
                DefensePathPoint::new(2, 0, true),
                DefensePathPoint::new(3, 0, false),
            ],
            DefensePoint::new(0, 0),
            DefensePoint::new(3, 0),
            8,
        );

        assert!(result.blocked);
        assert_eq!(result.intercepting_defenses, 1);
        assert_eq!(result.interception_capacity, 3);
    }

    #[test]
    fn replacing_index_removes_stale_coverage() {
        let mut index = DefenseIndex::new(4).unwrap();
        index.replace([Defense::new(1, 2, 0, 2, 1)]);
        assert_eq!(index.len(), 1);

        index.replace([Defense::new(2, 100, 100, 1, 1)]);
        let result = index.assess_path(
            line_path(0, 5, 0),
            DefensePoint::new(0, 0),
            DefensePoint::new(5, 0),
            8,
        );
        assert_eq!(result.interception_capacity, 0);
    }

    #[test]
    fn duplicate_ids_use_last_record_once() {
        let mut index = DefenseIndex::new(4).unwrap();
        index.replace([Defense::new(5, 50, 50, 1, 1), Defense::new(5, 1, 0, 2, 4)]);

        let result = index.assess_path(
            [DefensePathPoint::new(1, 0, false)],
            DefensePoint::new(0, 0),
            DefensePoint::new(10, 0),
            8,
        );
        assert_eq!(index.len(), 1);
        assert_eq!(result.intercepting_defenses, 1);
        assert_eq!(result.interception_capacity, 4);
    }
}
