#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_neighbors4(handle: u32, tile: u32) -> u32 {
    query_tiles(handle, |map| {
        Ok(map
            .neighbors4(TileRef::new(tile))?
            .as_slice()
            .to_vec())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_neighbors8(handle: u32, tile: u32) -> u32 {
    query_tiles(handle, |map| {
        Ok(map
            .neighbors8(TileRef::new(tile))?
            .as_slice()
            .to_vec())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_connected_owner(handle: u32, start: u32) -> u32 {
    query_tiles(handle, |map| {
        let start = TileRef::new(start);
        let owner = map.state(start)?.owner_id();
        map.bfs(start, |map, tile| {
            map.state(tile)
                .map(|state| state.owner_id() == owner)
                .unwrap_or(false)
        })
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MaskQueryError {
    InvalidMapHandle,
    InvalidUploadHandle,
    Query(ErrorCode),
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_connected_mask(
    handle: u32,
    start: u32,
    upload_handle: u32,
) -> u32 {
    begin_call();

    let result = UPLOADS.with(|uploads| {
        let uploads = uploads.borrow();
        let upload_index = slot_index(upload_handle).ok_or(MaskQueryError::InvalidUploadHandle)?;
        let mask = uploads
            .get(upload_index)
            .and_then(Option::as_ref)
            .ok_or(MaskQueryError::InvalidUploadHandle)?;

        MAPS.with(|maps| {
            let maps = maps.borrow();
            let map_index = slot_index(handle).ok_or(MaskQueryError::InvalidMapHandle)?;
            let map = maps
                .get(map_index)
                .and_then(Option::as_ref)
                .ok_or(MaskQueryError::InvalidMapHandle)?;

            if mask.len() != map.tile_count() as usize {
                return Err(MaskQueryError::Query(ErrorCode::MaskLengthMismatch));
            }

            map.bfs(TileRef::new(start), |_, tile| mask[tile.get() as usize] != 0)
                .map_err(|error| MaskQueryError::Query(map_error(error)))
        })
    });

    match result {
        Ok(tiles) => {
            set_result(tiles.into_iter().map(TileRef::get));
            1
        }
        Err(MaskQueryError::InvalidMapHandle | MaskQueryError::InvalidUploadHandle) => {
            fail(ErrorCode::InvalidHandle);
            0
        }
        Err(MaskQueryError::Query(error)) => {
            fail(error);
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_result_ptr() -> u32 {
    RESULT.with(|result| result.borrow().as_ptr() as usize as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_result_len() -> u32 {
    RESULT.with(|result| result.borrow().len() as u32)
}
