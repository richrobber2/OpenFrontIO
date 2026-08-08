fn decode_u16_upload(bytes: &[u8]) -> Option<Vec<u16>> {
    if bytes.len() % 2 != 0 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect(),
    )
}

fn territory_error(error: TerritoryRenderError) -> ErrorCode {
    match error {
        TerritoryRenderError::SizeOverflow => ErrorCode::InvalidDimensions,
        TerritoryRenderError::StateLengthMismatch { .. } => {
            ErrorCode::TerritoryStateLengthMismatch
        }
        TerritoryRenderError::InvalidTileRef { .. } => ErrorCode::InvalidTile,
    }
}

fn with_territory_renderer<R>(
    handle: u32,
    operation: impl FnOnce(&TerritoryRenderQueue) -> R,
) -> Option<R> {
    TERRITORY_RENDERERS.with(|renderers| {
        let renderers = renderers.borrow();
        let index = slot_index(handle)?;
        Some(operation(renderers.get(index)?.as_ref()?))
    })
}

fn with_territory_renderer_mut<R>(
    handle: u32,
    operation: impl FnOnce(&mut TerritoryRenderQueue) -> R,
) -> Option<R> {
    TERRITORY_RENDERERS.with(|renderers| {
        let mut renderers = renderers.borrow_mut();
        let index = slot_index(handle)?;
        Some(operation(renderers.get_mut(index)?.as_mut()?))
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_create(
    width: u32,
    height: u32,
    bucket_count: u32,
    state_upload: u32,
) -> u32 {
    begin_call();
    let state = UPLOADS.with(|uploads| {
        let uploads = uploads.borrow();
        let index = slot_index(state_upload)?;
        let bytes = uploads.get(index)?.as_ref()?;
        decode_u16_upload(bytes)
    });
    let Some(state) = state else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    let queue = match TerritoryRenderQueue::new(width, height, bucket_count as usize, &state) {
        Ok(queue) => queue,
        Err(error) => {
            fail(territory_error(error));
            return 0;
        }
    };
    TERRITORY_RENDERERS.with(|renderers| insert_slot(&mut renderers.borrow_mut(), queue))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_destroy(handle: u32) -> u32 {
    begin_call();
    let removed = TERRITORY_RENDERERS.with(|renderers| {
        let mut renderers = renderers.borrow_mut();
        remove_slot(renderers.as_mut_slice(), handle)
    });
    if removed {
        1
    } else {
        fail(ErrorCode::InvalidHandle);
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_replace(
    handle: u32,
    state_upload: u32,
) -> u32 {
    begin_call();
    let state = UPLOADS.with(|uploads| {
        let uploads = uploads.borrow();
        let index = slot_index(state_upload)?;
        let bytes = uploads.get(index)?.as_ref()?;
        decode_u16_upload(bytes)
    });
    let Some(state) = state else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    let Some(result) = with_territory_renderer_mut(handle, |queue| queue.replace_state(&state)) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    match result {
        Ok(()) => 1,
        Err(error) => {
            fail(territory_error(error));
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_enqueue(
    handle: u32,
    update_upload: u32,
    count: u32,
) -> u32 {
    begin_call();
    let byte_count = match (count as usize).checked_mul(8) {
        Some(value) => value,
        None => {
            fail(ErrorCode::TerritoryUpdateRecordLengthMismatch);
            return 0;
        }
    };
    let updates = UPLOADS.with(|uploads| {
        let uploads = uploads.borrow();
        let index = slot_index(update_upload)?;
        let bytes = uploads.get(index)?.as_ref()?;
        if bytes.len() < byte_count {
            return None;
        }
        let mut updates = Vec::with_capacity(count as usize);
        for chunk in bytes[..byte_count].chunks_exact(8) {
            let tile_ref = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            let state = u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]) as u16;
            updates.push((tile_ref, state));
        }
        Some(updates)
    });
    let Some(updates) = updates else {
        fail(ErrorCode::TerritoryUpdateRecordLengthMismatch);
        return 0;
    };

    let Some(result) = with_territory_renderer_mut(handle, |queue| queue.enqueue_updates(&updates))
    else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    match result {
        Ok(newly_queued) => newly_queued as u32,
        Err(error) => {
            fail(territory_error(error));
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_drain_next(handle: u32) -> u32 {
    begin_call();
    let Some(drained) = with_territory_renderer_mut(handle, TerritoryRenderQueue::drain_next) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    drained as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_drain_all(handle: u32) -> u32 {
    begin_call();
    let Some(drained) = with_territory_renderer_mut(handle, TerritoryRenderQueue::drain_all) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    drained as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_clear(handle: u32) -> u32 {
    begin_call();
    let Some(()) = with_territory_renderer_mut(handle, TerritoryRenderQueue::clear_pending) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_queued(handle: u32) -> u32 {
    begin_call();
    let Some(queued) = with_territory_renderer(handle, TerritoryRenderQueue::queued) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    queued as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_tile_patch_ptr(handle: u32) -> u32 {
    begin_call();
    let Some(ptr) = with_territory_renderer(handle, |queue| queue.tile_patches().as_ptr() as usize)
    else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    ptr as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_tile_patch_len(handle: u32) -> u32 {
    begin_call();
    let Some(len) = with_territory_renderer(handle, |queue| queue.tile_patches().len()) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    len as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_border_change_ptr(handle: u32) -> u32 {
    begin_call();
    let Some(ptr) = with_territory_renderer(handle, |queue| queue.border_changes().as_ptr() as usize)
    else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    ptr as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_border_change_len(handle: u32) -> u32 {
    begin_call();
    let Some(len) = with_territory_renderer(handle, |queue| queue.border_changes().len()) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    len as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_display_ptr(handle: u32) -> u32 {
    begin_call();
    let Some(ptr) = with_territory_renderer(handle, |queue| queue.display_state().as_ptr() as usize)
    else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    ptr as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_display_len(handle: u32) -> u32 {
    begin_call();
    let Some(len) = with_territory_renderer(handle, |queue| queue.display_state().len()) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    len as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_territory_renderer_fallout_touched(handle: u32) -> u32 {
    begin_call();
    let Some(touched) = with_territory_renderer(handle, TerritoryRenderQueue::fallout_touched) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    if touched { 1 } else { 0 }
}

#[cfg(test)]
mod territory_render_tests {
    use super::*;

    fn upload_bytes(values: &[u8]) -> u32 {
        let handle = openfront_upload_create(values.len() as u32);
        for (index, value) in values.iter().enumerate() {
            assert_eq!(openfront_upload_set(handle, index as u32, *value as u32), 1);
        }
        handle
    }

    fn upload_u16(values: &[u16]) -> u32 {
        let mut bytes = Vec::with_capacity(values.len() * 2);
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        upload_bytes(&bytes)
    }

    fn upload_updates(values: &[(u32, u32)]) -> u32 {
        let mut bytes = Vec::with_capacity(values.len() * 8);
        for &(tile_ref, state) in values {
            bytes.extend_from_slice(&tile_ref.to_le_bytes());
            bytes.extend_from_slice(&state.to_le_bytes());
        }
        upload_bytes(&bytes)
    }

    #[test]
    fn wasm_queue_coalesces_and_exposes_gpu_patch_buffers() {
        TERRITORY_RENDERERS.with(|renderers| renderers.borrow_mut().clear());
        UPLOADS.with(|uploads| uploads.borrow_mut().clear());

        let state_upload = upload_u16(&[0, 0, 0, 0]);
        let queue = openfront_territory_renderer_create(2, 2, 2, state_upload);
        assert_ne!(queue, 0);

        let updates = upload_updates(&[(3, 4), (3, 9)]);
        assert_eq!(openfront_territory_renderer_enqueue(queue, updates, 2), 1);
        assert_eq!(openfront_territory_renderer_drain_all(queue), 1);
        assert_eq!(openfront_territory_renderer_tile_patch_len(queue), 3);
        assert_eq!(openfront_territory_renderer_border_change_len(queue), 4);

        TERRITORY_RENDERERS.with(|renderers| {
            let renderers = renderers.borrow();
            let staged = renderers[slot_index(queue).unwrap()].as_ref().unwrap();
            assert_eq!(staged.tile_patches(), &[1.0, 1.0, 9.0]);
            assert_eq!(staged.border_changes(), &[1, 1, 0, 9]);
        });
    }
}
