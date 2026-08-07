use std::collections::HashMap;
use std::ops::Range;

/// Floats consumed by StructurePass for each instanced structure:
/// x, y, ownerID, underConstruction, atlasIdx, markedForDeletion.
pub const STRUCTURE_FLOATS_PER_INSTANCE: usize = 6;

/// Compact persistent structure-instance table.
///
/// Unit IDs stay in a side table so removals can use swap-remove while the
/// packed float array remains directly uploadable to WebGL. Each batch tracks
/// the smallest contiguous slot range that changed; callers only need to patch
/// that range on the GPU unless their GPU buffer itself had to grow.
#[derive(Debug, Default)]
pub struct StructureRenderState {
    slot_ids: Vec<u32>,
    packed: Vec<f32>,
    id_to_slot: HashMap<u32, usize>,
    dirty_start: usize,
    dirty_end: usize,
    dirty: bool,
}

impl StructureRenderState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reset dirty tracking before applying a new delta batch.
    pub fn begin_batch(&mut self) {
        self.dirty = false;
        self.dirty_start = 0;
        self.dirty_end = 0;
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert(
        &mut self,
        id: u32,
        x: f32,
        y: f32,
        owner_id: u32,
        under_construction: bool,
        atlas_idx: u32,
        marked_for_deletion: bool,
    ) {
        let values = [
            x,
            y,
            owner_id as f32,
            if under_construction { 1.0 } else { 0.0 },
            atlas_idx as f32,
            if marked_for_deletion { 1.0 } else { 0.0 },
        ];

        if let Some(&slot) = self.id_to_slot.get(&id) {
            let offset = slot * STRUCTURE_FLOATS_PER_INSTANCE;
            let current = &self.packed[offset..offset + STRUCTURE_FLOATS_PER_INSTANCE];
            if current == values.as_slice() {
                return;
            }
            self.packed[offset..offset + STRUCTURE_FLOATS_PER_INSTANCE]
                .copy_from_slice(&values);
            self.mark_dirty(slot, slot + 1);
            return;
        }

        let slot = self.slot_ids.len();
        self.slot_ids.push(id);
        self.id_to_slot.insert(id, slot);
        self.packed.extend_from_slice(&values);
        self.mark_dirty(slot, slot + 1);
    }

    /// Remove an instance while keeping the packed table dense.
    ///
    /// If a non-tail slot is removed, the last instance is copied into its
    /// place and that single slot is marked dirty. Removing the tail needs no
    /// byte upload because lowering the instance count is sufficient.
    pub fn remove(&mut self, id: u32) -> bool {
        let Some(slot) = self.id_to_slot.remove(&id) else {
            return false;
        };

        let last = self.slot_ids.len() - 1;
        if slot != last {
            let moved_id = self.slot_ids[last];
            let src = last * STRUCTURE_FLOATS_PER_INSTANCE;
            let dst = slot * STRUCTURE_FLOATS_PER_INSTANCE;
            for lane in 0..STRUCTURE_FLOATS_PER_INSTANCE {
                let value = self.packed[src + lane];
                self.packed[dst + lane] = value;
            }
            self.slot_ids[slot] = moved_id;
            self.id_to_slot.insert(moved_id, slot);
            self.mark_dirty(slot, slot + 1);
        }

        self.slot_ids.pop();
        self.packed
            .truncate(last * STRUCTURE_FLOATS_PER_INSTANCE);
        true
    }

    pub fn len(&self) -> usize {
        self.slot_ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slot_ids.is_empty()
    }

    pub fn packed(&self) -> &[f32] {
        &self.packed
    }

    pub fn dirty_slots(&self) -> Option<Range<usize>> {
        self.dirty
            .then_some(self.dirty_start..self.dirty_end)
    }

    fn mark_dirty(&mut self, start: usize, end: usize) {
        if !self.dirty {
            self.dirty = true;
            self.dirty_start = start;
            self.dirty_end = end;
            return;
        }
        self.dirty_start = self.dirty_start.min(start);
        self.dirty_end = self.dirty_end.max(end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_population_only_dirties_changed_slot_after_initial_upload() {
        let mut state = StructureRenderState::new();
        state.begin_batch();
        for id in 0..1_200u32 {
            state.upsert(id, id as f32, 3.0, 7, false, id % 6, false);
        }
        assert_eq!(state.len(), 1_200);
        assert_eq!(state.dirty_slots(), Some(0..1_200));
        assert_eq!(
            state.packed().len(),
            1_200 * STRUCTURE_FLOATS_PER_INSTANCE
        );

        state.begin_batch();
        state.upsert(777, 55.0, 66.0, 8, true, 4, false);
        assert_eq!(state.dirty_slots(), Some(777..778));
        let off = 777 * STRUCTURE_FLOATS_PER_INSTANCE;
        assert_eq!(&state.packed()[off..off + 6], &[55.0, 66.0, 8.0, 1.0, 4.0, 0.0]);
    }

    #[test]
    fn removal_swap_compacts_and_dirties_only_replacement_slot() {
        let mut state = StructureRenderState::new();
        state.begin_batch();
        state.upsert(10, 1.0, 2.0, 3, false, 0, false);
        state.upsert(20, 4.0, 5.0, 6, false, 1, false);
        state.upsert(30, 7.0, 8.0, 9, false, 2, true);

        state.begin_batch();
        assert!(state.remove(20));
        assert_eq!(state.len(), 2);
        assert_eq!(state.dirty_slots(), Some(1..2));
        assert_eq!(&state.packed()[6..12], &[7.0, 8.0, 9.0, 0.0, 2.0, 1.0]);

        state.begin_batch();
        assert!(state.remove(30));
        assert_eq!(state.len(), 1);
        assert_eq!(state.dirty_slots(), None);
    }
}
