#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_rail_path(
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

    let Some(result) = with_map(handle, |map| {
        openfront_core::rail_path(map, &starts, TileRef::new(goal))
    }) else {
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
