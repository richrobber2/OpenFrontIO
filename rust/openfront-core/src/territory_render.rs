//! CPU-side territory render staging for the WebGL renderer.
//!
//! The GPU still owns rasterization. This queue removes the per-tile
//! JavaScript bookkeeping that used to sit in front of the tile scatter pass:
//! deduplication, drip-bucket scheduling, displayed-state tracking, owner
//! extraction, fallout detection, and coordinate packing all happen here.

use crate::tile::{FALLOUT_MASK, OWNER_ID_MASK};

const HASH_MULTIPLIER: u32 = 2_654_435_761;
pub const TERRITORY_TILE_PATCH_FLOATS: usize = 3;
pub const TERRITORY_BORDER_CHANGE_WORDS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerritoryRenderError {
    SizeOverflow,
    StateLengthMismatch { expected: usize, actual: usize },
    InvalidTileRef { tile_ref: u32, tile_count: usize },
}

/// Persistent render-side state for incremental territory texture updates.
///
/// `latest_state` mirrors the newest simulation values for refs that have been
/// queued, while `display_state` mirrors what the renderer has actually allowed
/// through the drip scheduler. Repeated updates to a pending ref only replace
/// its latest value, matching the old TypeScript `TileDripQueue` behaviour.
pub struct TerritoryRenderQueue {
    width: u32,
    height: u32,
    pending: Vec<u8>,
    latest_state: Vec<u16>,
    display_state: Vec<u16>,
    buckets: Vec<Vec<u32>>,
    current_bucket: usize,
    queued: usize,
    tile_patches: Vec<f32>,
    border_changes: Vec<u32>,
    fallout_touched: bool,
}

impl TerritoryRenderQueue {
    pub fn new(
        width: u32,
        height: u32,
        bucket_count: usize,
        initial_state: &[u16],
    ) -> Result<Self, TerritoryRenderError> {
        let tile_count = (width as usize)
            .checked_mul(height as usize)
            .ok_or(TerritoryRenderError::SizeOverflow)?;
        if initial_state.len() != tile_count {
            return Err(TerritoryRenderError::StateLengthMismatch {
                expected: tile_count,
                actual: initial_state.len(),
            });
        }

        let bucket_count = bucket_count.max(1);
        Ok(Self {
            width,
            height,
            pending: vec![0; tile_count],
            latest_state: initial_state.to_vec(),
            display_state: initial_state.to_vec(),
            buckets: (0..bucket_count).map(|_| Vec::new()).collect(),
            current_bucket: 0,
            queued: 0,
            tile_patches: Vec::new(),
            border_changes: Vec::new(),
            fallout_touched: false,
        })
    }

    #[inline]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[inline]
    pub fn height(&self) -> u32 {
        self.height
    }

    #[inline]
    pub fn queued(&self) -> usize {
        self.queued
    }

    #[inline]
    pub fn display_state(&self) -> &[u16] {
        &self.display_state
    }

    /// `[x, y, state, ...]`, ready for the WebGL tile scatter VBO.
    #[inline]
    pub fn tile_patches(&self) -> &[f32] {
        &self.tile_patches
    }

    /// `[x, y, previous_owner, new_owner, ...]` for owner changes only.
    #[inline]
    pub fn border_changes(&self) -> &[u32] {
        &self.border_changes
    }

    #[inline]
    pub fn fallout_touched(&self) -> bool {
        self.fallout_touched
    }

    pub fn replace_state(&mut self, state: &[u16]) -> Result<(), TerritoryRenderError> {
        if state.len() != self.display_state.len() {
            return Err(TerritoryRenderError::StateLengthMismatch {
                expected: self.display_state.len(),
                actual: state.len(),
            });
        }
        self.latest_state.copy_from_slice(state);
        self.display_state.copy_from_slice(state);
        self.clear_pending();
        self.clear_outputs();
        Ok(())
    }

    /// Queue a batch of `(tile_ref, newest_state)` records.
    ///
    /// The whole batch is validated before mutation so an invalid tile cannot
    /// leave half an upload queued.
    pub fn enqueue_updates(
        &mut self,
        updates: &[(u32, u16)],
    ) -> Result<usize, TerritoryRenderError> {
        let tile_count = self.pending.len();
        for &(tile_ref, _) in updates {
            if tile_ref as usize >= tile_count {
                return Err(TerritoryRenderError::InvalidTileRef {
                    tile_ref,
                    tile_count,
                });
            }
        }

        let mut newly_queued = 0;
        for &(tile_ref, state) in updates {
            let index = tile_ref as usize;
            self.latest_state[index] = state;
            if self.pending[index] != 0 {
                continue;
            }

            self.pending[index] = 1;
            let hash = tile_ref.wrapping_mul(HASH_MULTIPLIER);
            let bucket = hash as usize % self.buckets.len();
            self.buckets[bucket].push(tile_ref);
            self.queued += 1;
            newly_queued += 1;
        }
        Ok(newly_queued)
    }

    /// Drain the next round-robin bucket. The returned count is the number of
    /// queued refs consumed; `tile_patches()` can be smaller when a ref's latest
    /// state equals the state already displayed.
    pub fn drain_next(&mut self) -> usize {
        self.clear_outputs();
        let bucket_index = self.current_bucket;
        let refs = std::mem::take(&mut self.buckets[bucket_index]);
        let drained = refs.len();
        self.queued -= drained;
        self.current_bucket = (self.current_bucket + 1) % self.buckets.len();
        for tile_ref in refs {
            self.apply_ref(tile_ref);
        }
        drained
    }

    /// Drain every bucket immediately. Bucket traversal intentionally starts at
    /// zero, matching the old TypeScript `drainAll` ordering.
    pub fn drain_all(&mut self) -> usize {
        self.clear_outputs();
        let drained = self.queued;
        for bucket_index in 0..self.buckets.len() {
            let refs = std::mem::take(&mut self.buckets[bucket_index]);
            for tile_ref in refs {
                self.apply_ref(tile_ref);
            }
        }
        self.queued = 0;
        drained
    }

    pub fn clear_pending(&mut self) {
        for bucket in &mut self.buckets {
            bucket.clear();
        }
        self.pending.fill(0);
        self.current_bucket = 0;
        self.queued = 0;
    }

    fn clear_outputs(&mut self) {
        self.tile_patches.clear();
        self.border_changes.clear();
        self.fallout_touched = false;
    }

    #[inline]
    fn apply_ref(&mut self, tile_ref: u32) {
        let index = tile_ref as usize;
        self.pending[index] = 0;

        let next = self.latest_state[index];
        let previous = self.display_state[index];
        if next == previous {
            return;
        }

        if (next ^ previous) & FALLOUT_MASK != 0 {
            self.fallout_touched = true;
        }
        self.display_state[index] = next;

        let x = tile_ref % self.width;
        let y = tile_ref / self.width;
        self.tile_patches
            .extend_from_slice(&[x as f32, y as f32, next as f32]);

        let previous_owner = previous & OWNER_ID_MASK;
        let next_owner = next & OWNER_ID_MASK;
        if previous_owner != next_owner {
            self.border_changes.extend_from_slice(&[
                x,
                y,
                previous_owner as u32,
                next_owner as u32,
            ]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesces_pending_updates_and_uses_the_latest_state() {
        let mut queue = TerritoryRenderQueue::new(4, 2, 4, &[0; 8]).unwrap();
        assert_eq!(queue.enqueue_updates(&[(5, 3)]).unwrap(), 1);
        assert_eq!(queue.enqueue_updates(&[(5, 7)]).unwrap(), 0);
        assert_eq!(queue.queued(), 1);

        assert_eq!(queue.drain_all(), 1);
        assert_eq!(queue.tile_patches(), &[1.0, 1.0, 7.0]);
        assert_eq!(queue.border_changes(), &[1, 1, 0, 7]);
        assert_eq!(queue.display_state()[5], 7);
        assert_eq!(queue.queued(), 0);
    }

    #[test]
    fn emits_only_actual_display_changes() {
        let mut queue = TerritoryRenderQueue::new(2, 2, 2, &[4, 0, 0, 0]).unwrap();
        queue.enqueue_updates(&[(0, 4)]).unwrap();
        assert_eq!(queue.drain_all(), 1);
        assert!(queue.tile_patches().is_empty());
        assert!(queue.border_changes().is_empty());
        assert!(!queue.fallout_touched());
    }

    #[test]
    fn reports_owner_and_fallout_changes_in_gpu_ready_layouts() {
        let mut queue = TerritoryRenderQueue::new(3, 2, 3, &[0; 6]).unwrap();
        let state = 9 | FALLOUT_MASK;
        queue.enqueue_updates(&[(4, state)]).unwrap();
        queue.drain_all();

        assert_eq!(queue.tile_patches(), &[1.0, 1.0, state as f32]);
        assert_eq!(queue.border_changes(), &[1, 1, 0, 9]);
        assert!(queue.fallout_touched());
    }

    #[test]
    fn replace_state_resets_pending_work_and_outputs() {
        let mut queue = TerritoryRenderQueue::new(2, 1, 2, &[0, 0]).unwrap();
        queue.enqueue_updates(&[(1, 5)]).unwrap();
        queue.drain_all();
        queue.enqueue_updates(&[(0, 3)]).unwrap();

        queue.replace_state(&[8, 9]).unwrap();
        assert_eq!(queue.display_state(), &[8, 9]);
        assert_eq!(queue.queued(), 0);
        assert!(queue.tile_patches().is_empty());
        assert!(queue.border_changes().is_empty());
    }

    #[test]
    fn invalid_batch_is_rejected_before_mutation() {
        let mut queue = TerritoryRenderQueue::new(2, 1, 2, &[0, 0]).unwrap();
        assert_eq!(
            queue.enqueue_updates(&[(0, 2), (2, 3)]),
            Err(TerritoryRenderError::InvalidTileRef {
                tile_ref: 2,
                tile_count: 2,
            })
        );
        assert_eq!(queue.queued(), 0);
        assert_eq!(queue.display_state(), &[0, 0]);
    }
}
