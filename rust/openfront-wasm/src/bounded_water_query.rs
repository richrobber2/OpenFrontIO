#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_water_path_bounded(
    handle: u32,
    upload_handle: u32,
    goal: u32,
    min_x: u32,
    max_x: u32,
    min_y: u32,
    max_y: u32,
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

    let Some(map_index) = slot_index(handle) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    let area = max_x
        .checked_sub(min_x)
        .and_then(|width| width.checked_add(1))
        .and_then(|width| {
            max_y
                .checked_sub(min_y)
                .and_then(|height| height.checked_add(1))
                .and_then(|height| width.checked_mul(height))
        });
    let Some(area) = area else {
        set_result(std::iter::empty());
        return 1;
    };

    let result = MAPS.with(|maps| {
        let maps = maps.borrow();
        let Some(map) = maps.get(map_index).and_then(Option::as_ref) else {
            return None;
        };

        BOUNDED_WATER_FINDERS.with(|finders| {
            let mut finders = finders.borrow_mut();
            let finder = finders.get_mut(map_index)?.as_mut()?;
            finder.ensure_capacity(area as usize);
            Some(finder.search_bounded(
                map,
                &starts,
                TileRef::new(goal),
                openfront_core::SearchBounds {
                    min_x,
                    max_x,
                    min_y,
                    max_y,
                },
            ))
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
