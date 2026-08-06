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
enum QueryInputError {
    InvalidMapHandle,
    InvalidUploadHandle,
    Query(ErrorCode),
}

fn uploaded_u32s(upload_handle: u32) -> Result<Vec<u32>, QueryInputError> {
    UPLOADS.with(|uploads| {
        let uploads = uploads.borrow();
        let upload_index =
            slot_index(upload_handle).ok_or(QueryInputError::InvalidUploadHandle)?;
        let bytes = uploads
            .get(upload_index)
            .and_then(Option::as_ref)
            .ok_or(QueryInputError::InvalidUploadHandle)?;
        if bytes.len() % 4 != 0 {
            return Err(QueryInputError::Query(
                ErrorCode::TileListLengthMismatch,
            ));
        }

        Ok(bytes
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect())
    })
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
        let upload_index =
            slot_index(upload_handle).ok_or(QueryInputError::InvalidUploadHandle)?;
        let mask = uploads
            .get(upload_index)
            .and_then(Option::as_ref)
            .ok_or(QueryInputError::InvalidUploadHandle)?;

        MAPS.with(|maps| {
            let maps = maps.borrow();
            let map_index = slot_index(handle).ok_or(QueryInputError::InvalidMapHandle)?;
            let map = maps
                .get(map_index)
                .and_then(Option::as_ref)
                .ok_or(QueryInputError::InvalidMapHandle)?;

            if mask.len() != map.tile_count() as usize {
                return Err(QueryInputError::Query(ErrorCode::MaskLengthMismatch));
            }

            map.bfs(TileRef::new(start), |_, tile| mask[tile.get() as usize] != 0)
                .map_err(|error| QueryInputError::Query(map_error(error)))
        })
    });

    match result {
        Ok(tiles) => {
            set_result(tiles.into_iter().map(TileRef::get));
            1
        }
        Err(QueryInputError::InvalidMapHandle | QueryInputError::InvalidUploadHandle) => {
            fail(ErrorCode::InvalidHandle);
            0
        }
        Err(QueryInputError::Query(error)) => {
            fail(error);
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_owned_depths(
    handle: u32,
    upload_handle: u32,
    owner_id: u32,
    maximum_depth: u32,
) -> u32 {
    begin_call();
    if owner_id > u32::from(openfront_core::OWNER_ID_MASK) {
        fail(ErrorCode::OwnerIdOutOfRange);
        return 0;
    }

    let starts = match uploaded_u32s(upload_handle) {
        Ok(starts) => starts.into_iter().map(TileRef::new).collect::<Vec<_>>(),
        Err(QueryInputError::InvalidUploadHandle) => {
            fail(ErrorCode::InvalidHandle);
            return 0;
        }
        Err(QueryInputError::Query(error)) => {
            fail(error);
            return 0;
        }
        Err(QueryInputError::InvalidMapHandle) => unreachable!(),
    };

    let Some(result) = with_map(handle, |map| {
        map.owned_depths(&starts, owner_id as u16, maximum_depth)
    }) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(depths) => {
            set_result(
                depths
                    .into_iter()
                    .flat_map(|(tile, depth)| [tile.get(), depth]),
            );
            1
        }
        Err(error) => {
            fail(map_error(error));
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
