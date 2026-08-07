//! Water connected-component labeling matching `ConnectedComponents.ts`.

use crate::{GameMapError, GameMapStore, TileRef};

pub const LAND_COMPONENT_MARKER: u16 = u16::MAX;
const MAX_COMPONENT_ID: u16 = u16::MAX - 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectedWaterComponents {
    ids: Vec<u16>,
    sizes: Vec<u32>,
    component_count: u16,
}

impl ConnectedWaterComponents {
    pub fn build(map: &GameMapStore) -> Result<Self, GameMapError> {
        let tile_count = map.tile_count() as usize;
        let width = map.width() as usize;
        let height = map.height() as usize;
        let last_row_start = height.saturating_sub(1) * width;
        let mut ids = vec![0_u16; tile_count];

        for tile in map.tiles() {
            if !map.terrain(tile)?.is_water() {
                ids[tile.get() as usize] = LAND_COMPONENT_MARKER;
            }
        }

        let mut sizes = vec![0_u32];
        let mut queue = vec![0_u32; tile_count];
        let mut next_id = 0_u16;

        for start in 0..tile_count {
            if ids[start] != 0 {
                continue;
            }
            if next_id == MAX_COMPONENT_ID {
                break;
            }
            next_id += 1;
            if sizes.len() <= usize::from(next_id) {
                sizes.resize(usize::from(next_id) + 1, 0);
            }

            let mut head = 0_usize;
            let mut tail = 0_usize;
            queue[tail] = start as u32;
            tail += 1;

            while head < tail {
                let seed = queue[head] as usize;
                head += 1;
                if ids[seed] != 0 {
                    continue;
                }

                let row_start = seed - (seed % width);
                let row_end = row_start + width - 1;
                let mut left = seed;
                while left > row_start && ids[left - 1] == 0 {
                    left -= 1;
                }
                let mut right = seed;
                while right < row_end && ids[right + 1] == 0 {
                    right += 1;
                }

                sizes[usize::from(next_id)] += (right - left + 1) as u32;
                for x in left..=right {
                    ids[x] = next_id;
                    if x >= width {
                        let above = x - width;
                        if ids[above] == 0 {
                            queue[tail] = above as u32;
                            tail += 1;
                        }
                    }
                    if x < last_row_start {
                        let below = x + width;
                        if ids[below] == 0 {
                            queue[tail] = below as u32;
                            tail += 1;
                        }
                    }
                }
            }
        }

        Ok(Self {
            ids,
            sizes,
            component_count: next_id,
        })
    }

    #[must_use]
    pub fn component_count(&self) -> u16 {
        self.component_count
    }

    #[must_use]
    pub fn component_id(&self, tile: TileRef) -> Option<u16> {
        self.ids.get(tile.get() as usize).copied()
    }

    #[must_use]
    pub fn component_size(&self, component_id: u16) -> u32 {
        self.sizes
            .get(usize::from(component_id))
            .copied()
            .unwrap_or(0)
    }

    #[must_use]
    pub fn ids(&self) -> &[u16] {
        &self.ids
    }

    #[must_use]
    pub fn sizes(&self) -> &[u32] {
        &self.sizes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TERRAIN_LAND_MASK;

    #[test]
    fn labels_cardinal_water_components_in_scan_order() {
        let l = TERRAIN_LAND_MASK | 1;
        let w = 5_u8;
        let map = GameMapStore::new(
            5,
            4,
            vec![
                w, w, l, w, w,
                w, l, l, l, w,
                l, l, l, l, l,
                w, l, l, l, l,
            ],
        )
        .unwrap();
        let components = ConnectedWaterComponents::build(&map).unwrap();

        assert_eq!(components.component_count(), 3);
        assert_eq!(components.component_size(1), 3);
        assert_eq!(components.component_size(2), 3);
        assert_eq!(components.component_size(3), 1);
        assert_eq!(
            components.component_id(TileRef::new(2)),
            Some(LAND_COMPONENT_MARKER),
        );
    }
}
