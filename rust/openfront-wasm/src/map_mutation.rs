#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_packed_tile(handle: u32, tile: u32) -> u32 {
    begin_call();
    let Some(result) = with_map(handle, |map| map.packed_tile(TileRef::new(tile))) else {
        fail(ErrorCode::InvalidHandle);
        return INVALID_RESULT;
    };

    match result {
        Ok(packed) => packed.raw(),
        Err(error) => {
            fail(map_error(error));
            INVALID_RESULT
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_update_tile(handle: u32, tile: u32, packed: u32) -> u32 {
    begin_call();
    let Some(result) = with_map_mut(handle, |map| {
        map.update_tile(TileRef::new(tile), PackedTile::from_raw(packed))
    }) else {
        fail(ErrorCode::InvalidHandle);
        return INVALID_RESULT;
    };

    match result {
        Ok(changed) => {
            if changed {
                1
            } else {
                0
            }
        }
        Err(error) => {
            fail(map_error(error));
            INVALID_RESULT
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_set_owner_id(handle: u32, tile: u32, owner_id: u32) -> u32 {
    begin_call();
    let Some(result) = with_map_mut(handle, |map| {
        map.set_owner_id(TileRef::new(tile), owner_id)
    }) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(()) => 1,
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_set_fallout(handle: u32, tile: u32, value: u32) -> u32 {
    begin_call();
    let Some(result) = with_map_mut(handle, |map| {
        map.set_fallout(TileRef::new(tile), value != 0)
    }) else {
        fail(ErrorCode::InvalidHandle);
        return INVALID_RESULT;
    };

    match result {
        Ok(changed) => {
            if changed {
                1
            } else {
                0
            }
        }
        Err(error) => {
            fail(map_error(error));
            INVALID_RESULT
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_set_defense_bonus(
    handle: u32,
    tile: u32,
    value: u32,
) -> u32 {
    begin_call();
    let Some(result) = with_map_mut(handle, |map| {
        map.set_defense_bonus(TileRef::new(tile), value != 0)
    }) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(()) => 1,
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}
