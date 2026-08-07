fn run_water_path(handle: u32, starts: &[TileRef], goal: u32) -> u32 {
    let Some(map_index) = slot_index(handle) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    let result = MAPS.with(|maps| {
        let maps = maps.borrow();
        let Some(map) = maps.get(map_index).and_then(Option::as_ref) else {
            return None;
        };

        WATER_FINDERS.with(|finders| {
            let mut finders = finders.borrow_mut();
            let finder = finders.get_mut(map_index)?.as_mut()?;
            Some(finder.find_path(map, starts, TileRef::new(goal)))
        })
    });

    let Some(result) = result else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(Some(path)) => {
            set_result(path.into_iter().map(TileRef::get));
            1
        }
        Ok(None) => {
            set_result(std::iter::empty());
            1
        }
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_water_path(
    handle: u32,
    upload_handle: u32,
    goal: u32,
) -> u32 {
    begin_call();

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

    run_water_path(handle, &starts, goal)
}

/// Allocation-free fast path for the common case of one to four water starts.
/// Unused scalar lanes are ignored according to `count`.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_water_path_small(
    handle: u32,
    count: u32,
    start0: u32,
    start1: u32,
    start2: u32,
    start3: u32,
    goal: u32,
) -> u32 {
    begin_call();
    if count > 4 {
        fail(ErrorCode::TileListLengthMismatch);
        return 0;
    }

    let raw = [start0, start1, start2, start3];
    let mut starts = [TileRef::new(0); 4];
    for index in 0..count as usize {
        starts[index] = TileRef::new(raw[index]);
    }
    run_water_path(handle, &starts[..count as usize], goal)
}
