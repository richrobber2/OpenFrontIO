use openfront_core::{StructureRenderState, UnitKind, STRUCTURE_FLOATS_PER_INSTANCE};

const STRUCTURE_RECORD_WORDS: usize = 7;
const STRUCTURE_RECORD_BYTES: usize = STRUCTURE_RECORD_WORDS * 4;

struct WasmStructureRenderer {
    state: StructureRenderState,
}

fn structure_atlas_index(kind_index: u32) -> Option<u32> {
    match UnitKind::from_index(kind_index)? {
        UnitKind::City => Some(0),
        UnitKind::Port => Some(1),
        UnitKind::Factory => Some(2),
        UnitKind::DefensePost => Some(3),
        UnitKind::SamLauncher => Some(4),
        UnitKind::MissileSilo => Some(5),
        _ => None,
    }
}

fn read_u32(record: &[u8], word: usize) -> u32 {
    let offset = word * 4;
    u32::from_le_bytes([
        record[offset],
        record[offset + 1],
        record[offset + 2],
        record[offset + 3],
    ])
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_create() -> u32 {
    begin_call();
    STRUCTURE_RENDERERS.with(|renderers| {
        insert_slot(
            &mut renderers.borrow_mut(),
            WasmStructureRenderer {
                state: StructureRenderState::new(),
            },
        )
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_destroy(handle: u32) -> u32 {
    begin_call();
    let removed = STRUCTURE_RENDERERS.with(|renderers| {
        remove_slot(renderers.borrow_mut().as_mut_slice(), handle)
    });
    if removed {
        1
    } else {
        fail(ErrorCode::InvalidHandle);
        0
    }
}

/// Apply changed unit records to the persistent structure render table.
///
/// Upload layout is `count` little-endian u32 records:
/// `[id, canonical_kind, active, tile, owner_id, under_construction, marked_for_deletion]`.
/// The packed render table keeps the tile ref in lane 0 and reserves lane 1;
/// the browser converts that dirty lane pair to x/y using its renderer map
/// width immediately before the WebGL upload. Keeping this state map-agnostic
/// avoids coupling the incremental unit index to GameView construction order.
/// Non-structure and inactive records remove any existing structure slot.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_update(
    renderer_handle: u32,
    upload_handle: u32,
    count: u32,
) -> u32 {
    begin_call();

    let result = UPLOADS.with(|uploads| -> Result<(), ErrorCode> {
        let uploads = uploads.borrow();
        let upload_index = slot_index(upload_handle).ok_or(ErrorCode::InvalidHandle)?;
        let upload = uploads
            .get(upload_index)
            .and_then(|slot| slot.as_ref())
            .ok_or(ErrorCode::InvalidHandle)?;
        let required = (count as usize)
            .checked_mul(STRUCTURE_RECORD_BYTES)
            .ok_or(ErrorCode::StructureRecordLengthMismatch)?;
        if upload.len() < required {
            return Err(ErrorCode::StructureRecordLengthMismatch);
        }

        STRUCTURE_RENDERERS.with(|renderers| -> Result<(), ErrorCode> {
            let mut renderers = renderers.borrow_mut();
            let renderer_index = slot_index(renderer_handle).ok_or(ErrorCode::InvalidHandle)?;
            let renderer = renderers
                .get_mut(renderer_index)
                .and_then(|slot| slot.as_mut())
                .ok_or(ErrorCode::InvalidHandle)?;

            renderer.state.begin_batch();
            for record in upload[..required].chunks_exact(STRUCTURE_RECORD_BYTES) {
                let id = read_u32(record, 0);
                let kind = read_u32(record, 1);
                let active = read_u32(record, 2) != 0;
                let tile = read_u32(record, 3);
                let owner_id = read_u32(record, 4);
                let under_construction = read_u32(record, 5) != 0;
                let marked_for_deletion = read_u32(record, 6) != 0;

                let Some(atlas_idx) = structure_atlas_index(kind) else {
                    renderer.state.remove(id);
                    continue;
                };
                if !active {
                    renderer.state.remove(id);
                    continue;
                }

                renderer.state.upsert(
                    id,
                    tile as f32,
                    0.0,
                    owner_id,
                    under_construction,
                    atlas_idx,
                    marked_for_deletion,
                );
            }
            Ok(())
        })
    });

    match result {
        Ok(()) => 1,
        Err(error) => {
            fail(error);
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_instance_count(handle: u32) -> u32 {
    begin_call();
    STRUCTURE_RENDERERS.with(|renderers| {
        let renderers = renderers.borrow();
        let Some(index) = slot_index(handle) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        let Some(renderer) = renderers.get(index).and_then(|slot| slot.as_ref()) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        renderer.state.len() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_data_ptr(handle: u32) -> u32 {
    begin_call();
    STRUCTURE_RENDERERS.with(|renderers| {
        let renderers = renderers.borrow();
        let Some(index) = slot_index(handle) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        let Some(renderer) = renderers.get(index).and_then(|slot| slot.as_ref()) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        let packed = renderer.state.packed();
        if packed.is_empty() {
            0
        } else {
            packed.as_ptr() as usize as u32
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_data_len(handle: u32) -> u32 {
    begin_call();
    STRUCTURE_RENDERERS.with(|renderers| {
        let renderers = renderers.borrow();
        let Some(index) = slot_index(handle) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        let Some(renderer) = renderers.get(index).and_then(|slot| slot.as_ref()) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        renderer.state.packed().len() as u32
    })
}

/// First changed instance slot, or INVALID_RESULT when this batch only changed
/// the instance count (for example removing the tail) or changed nothing.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_dirty_start(handle: u32) -> u32 {
    begin_call();
    STRUCTURE_RENDERERS.with(|renderers| {
        let renderers = renderers.borrow();
        let Some(index) = slot_index(handle) else {
            fail(ErrorCode::InvalidHandle);
            return INVALID_RESULT;
        };
        let Some(renderer) = renderers.get(index).and_then(|slot| slot.as_ref()) else {
            fail(ErrorCode::InvalidHandle);
            return INVALID_RESULT;
        };
        renderer
            .state
            .dirty_slots()
            .map(|range| range.start as u32)
            .unwrap_or(INVALID_RESULT)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_dirty_len(handle: u32) -> u32 {
    begin_call();
    STRUCTURE_RENDERERS.with(|renderers| {
        let renderers = renderers.borrow();
        let Some(index) = slot_index(handle) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        let Some(renderer) = renderers.get(index).and_then(|slot| slot.as_ref()) else {
            fail(ErrorCode::InvalidHandle);
            return 0;
        };
        renderer
            .state
            .dirty_slots()
            .map(|range| (range.end - range.start) as u32)
            .unwrap_or(0)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_structure_renderer_floats_per_instance() -> u32 {
    STRUCTURE_FLOATS_PER_INSTANCE as u32
}
