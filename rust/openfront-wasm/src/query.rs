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

/// Result layout:
/// `[owner_id, tile_count, border_count, depth_count, borders..., tile, depth, ...]`.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_owner_territory_analysis(
    handle: u32,
    owner_id: u32,
    maximum_depth: u32,
) -> u32 {
    begin_call();
    if owner_id > u32::from(openfront_core::OWNER_ID_MASK) {
        fail(ErrorCode::OwnerIdOutOfRange);
        return 0;
    }

    let Some(result) = with_map(handle, |map| {
        map.analyze_owner_territory(owner_id as u16, maximum_depth)
    }) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(analysis) => {
            let mut output = Vec::with_capacity(
                4 + analysis.borders.len() + analysis.depths.len() * 2,
            );
            output.push(owner_id);
            output.push(analysis.tile_count);
            output.push(analysis.borders.len() as u32);
            output.push(analysis.depths.len() as u32);
            output.extend(analysis.borders.into_iter().map(TileRef::get));
            output.extend(
                analysis
                    .depths
                    .into_iter()
                    .flat_map(|(tile, depth)| [tile.get(), depth]),
            );
            set_result(output);
            1
        }
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}

/// Performs the whole production-shaped interior-depth preparation in Rust:
/// count territories, select the largest owner in tile-scan insertion order,
/// discover that owner's border tiles, and run the multi-source depth search.
///
/// Result layout is `[owner_id, border_count, tile, depth, tile, depth, ...]`.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_largest_owned_depths(
    handle: u32,
    maximum_depth: u32,
) -> u32 {
    begin_call();

    let Some(result) = with_map(handle, |map| -> Result<Vec<u32>, GameMapError> {
        let mut owner_counts = vec![0_u32; usize::from(openfront_core::OWNER_ID_MASK) + 1];
        for tile in map.tiles() {
            let owner_id = usize::from(map.state(tile)?.owner_id());
            if owner_id != 0 {
                owner_counts[owner_id] += 1;
            }
        }

        let mut selected_owner = 0_u16;
        let mut selected_tiles = 0_u32;
        let mut owner_seen = vec![false; owner_counts.len()];
        for tile in map.tiles() {
            let owner_id = map.state(tile)?.owner_id();
            if owner_id == 0 || owner_seen[usize::from(owner_id)] {
                continue;
            }
            owner_seen[usize::from(owner_id)] = true;
            let count = owner_counts[usize::from(owner_id)];
            if count > selected_tiles {
                selected_owner = owner_id;
                selected_tiles = count;
            }
        }

        if selected_owner == 0 {
            return Ok(vec![0, 0]);
        }

        let mut borders = Vec::new();
        for tile in map.tiles() {
            if map.state(tile)?.owner_id() != selected_owner {
                continue;
            }
            let neighbors = map.neighbors4(tile)?;
            if neighbors.as_slice().iter().any(|neighbor| {
                map.state(*neighbor)
                    .map(|state| state.owner_id() != selected_owner)
                    .unwrap_or(false)
            }) {
                borders.push(tile);
            }
        }

        if borders.is_empty() {
            return Ok(vec![u32::from(selected_owner), 0]);
        }

        let depths = map.owned_depths(&borders, selected_owner, maximum_depth)?;
        let mut output = Vec::with_capacity(2 + depths.len() * 2);
        output.push(u32::from(selected_owner));
        output.push(borders.len() as u32);
        output.extend(
            depths
                .into_iter()
                .flat_map(|(tile, depth)| [tile.get(), depth]),
        );
        Ok(output)
    }) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(values) => {
            set_result(values);
            1
        }
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_air_path(
    handle: u32,
    from: u32,
    to: u32,
    seed: u32,
) -> u32 {
    begin_call();

    let Some(result) = with_map(handle, |map| {
        openfront_core::air_path(
            map.geometry(),
            TileRef::new(from),
            TileRef::new(to),
            seed as i32,
        )
    }) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(path) => {
            set_result(path.into_iter().map(TileRef::get));
            1
        }
        Err(_) => {
            fail(ErrorCode::InvalidTile);
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
