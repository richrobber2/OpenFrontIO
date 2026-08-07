#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_create(width: u32, height: u32, upload_handle: u32) -> u32 {
    begin_call();
    let terrain = UPLOADS.with(|uploads| {
        let mut uploads = uploads.borrow_mut();
        let index = slot_index(upload_handle)?;
        uploads.get_mut(index)?.take()
    });

    let Some(terrain) = terrain else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match GameMapStore::new(width, height, terrain) {
        Ok(map) => {
            let tile_count = map.tile_count() as usize;
            let handle = MAPS.with(|maps| insert_slot(&mut maps.borrow_mut(), map));
            let index = slot_index(handle).expect("new map handles are nonzero");
            WATER_FINDERS.with(|finders| {
                let mut finders = finders.borrow_mut();
                if finders.len() <= index {
                    finders.resize_with(index + 1, || None);
                }
                finders[index] = Some(WaterPathFinder::new(tile_count));
            });
            RAIL_FINDERS.with(|finders| {
                let mut finders = finders.borrow_mut();
                if finders.len() <= index {
                    finders.resize_with(index + 1, || None);
                }
                finders[index] = Some(RailPathFinder::new(width, height));
            });
            handle
        }
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_destroy(handle: u32) -> u32 {
    begin_call();
    let removed = MAPS.with(|maps| {
        let mut maps = maps.borrow_mut();
        remove_slot(maps.as_mut_slice(), handle)
    });
    if removed {
        WATER_FINDERS.with(|finders| {
            let mut finders = finders.borrow_mut();
            let _ = remove_slot(finders.as_mut_slice(), handle);
        });
        RAIL_FINDERS.with(|finders| {
            let mut finders = finders.borrow_mut();
            let _ = remove_slot(finders.as_mut_slice(), handle);
        });
        1
    } else {
        fail(ErrorCode::InvalidHandle);
        0
    }
}

macro_rules! map_counter_export {
    ($name:ident, $method:ident) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $name(handle: u32) -> u32 {
            begin_call();
            with_map(handle, GameMapStore::$method).unwrap_or_else(|| {
                fail(ErrorCode::InvalidHandle);
                INVALID_RESULT
            })
        }
    };
}

map_counter_export!(openfront_map_width, width);
map_counter_export!(openfront_map_height, height);
map_counter_export!(openfront_map_tile_count, tile_count);
map_counter_export!(openfront_map_num_land_tiles, num_land_tiles);
map_counter_export!(
    openfront_map_num_tiles_with_fallout,
    num_tiles_with_fallout
);
