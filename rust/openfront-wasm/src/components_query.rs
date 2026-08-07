#[unsafe(no_mangle)]
pub extern "C" fn openfront_map_water_components(handle: u32) -> u32 {
    begin_call();

    let Some(result) = with_map(handle, openfront_core::ConnectedWaterComponents::build) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    match result {
        Ok(components) => {
            let tile_count = components.ids().len() as u32;
            let component_count = u32::from(components.component_count());
            let land_marker = if components.component_count() >= 253 {
                u32::from(openfront_core::LAND_COMPONENT_MARKER)
            } else {
                0xff
            };
            let mut output = Vec::with_capacity(
                2 + components.ids().len() + components.component_count() as usize,
            );
            output.push(tile_count);
            output.push(component_count);
            output.extend(components.ids().iter().map(|&id| {
                if id == openfront_core::LAND_COMPONENT_MARKER {
                    land_marker
                } else {
                    u32::from(id)
                }
            }));
            for id in 1..=components.component_count() {
                output.push(components.component_size(id));
            }
            set_result(output);
            1
        }
        Err(error) => {
            fail(map_error(error));
            0
        }
    }
}
