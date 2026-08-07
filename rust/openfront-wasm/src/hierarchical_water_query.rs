fn run_hierarchical_water_path(handle: u32, starts: &[TileRef], goal: u32) -> u32 {
    let Some(map_index) = slot_index(handle) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    let result = MAPS.with(|maps| {
        let maps = maps.borrow();
        let Some(map) = maps.get(map_index).and_then(Option::as_ref) else {
            return None;
        };

        HIERARCHICAL_WATER_FINDERS.with(|finders| {
            let mut finders = finders.borrow_mut();
            if finders.len() <= map_index {
                finders.resize_with(map_index + 1, || None);
            }
            if finders[map_index].is_none() {
                match HierarchicalWaterPathFinder::build(map, DEFAULT_CLUSTER_SIZE) {
                    Ok(finder) => finders[map_index] = Some(finder),
                    Err(error) => return Some(Err(error)),
                }
            }
            let finder = finders[map_index].as_mut().expect("finder was initialized");
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
pub extern "C" fn openfront_map_water_path_hierarchical(
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
    run_hierarchical_water_path(handle, &starts, goal)
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_water_path_hierarchical_small(
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
    run_hierarchical_water_path(handle, &starts[..count as usize], goal)
}
