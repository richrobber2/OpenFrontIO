fn unpack_rgb(packed: u32) -> [u8; 3] {
    [
        ((packed >> 16) & 0xff) as u8,
        ((packed >> 8) & 0xff) as u8,
        (packed & 0xff) as u8,
    ]
}

fn read_upload_bytes(handle: u32) -> Option<Vec<u8>> {
    UPLOADS.with(|uploads| {
        let uploads = uploads.borrow();
        let index = slot_index(handle)?;
        Some(uploads.get(index)?.as_ref()?.clone())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_graphics_terrain_rgba(
    terrain_upload: u32,
    width: u32,
    height: u32,
    ocean: u32,
    sand: u32,
    plains: u32,
    highland: u32,
    mountain: u32,
) -> u32 {
    begin_call();
    let Some(terrain) = read_upload_bytes(terrain_upload) else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };

    let palette = TerrainPalette {
        ocean: unpack_rgb(ocean),
        sand: unpack_rgb(sand),
        plains: unpack_rgb(plains),
        highland: unpack_rgb(highland),
        mountain: unpack_rgb(mountain),
    };

    match build_terrain_rgba(&terrain, width, height, palette) {
        Ok(rgba) => UPLOADS.with(|uploads| insert_slot(&mut uploads.borrow_mut(), rgba)),
        Err(TerrainGraphicsError::SizeOverflow) => {
            fail(ErrorCode::InvalidDimensions);
            0
        }
        Err(TerrainGraphicsError::TerrainLengthMismatch { .. }) => {
            fail(ErrorCode::TerrainLengthMismatch);
            0
        }
    }
}

#[cfg(test)]
mod graphics_tests {
    use super::*;

    #[test]
    fn terrain_rgba_export_returns_an_upload_buffer() {
        UPLOADS.with(|uploads| uploads.borrow_mut().clear());
        begin_call();

        let input = openfront_upload_create(2);
        assert_eq!(openfront_upload_set(input, 0, 0), 1);
        assert_eq!(openfront_upload_set(input, 1, 0x80 | 5), 1);

        let output = openfront_graphics_terrain_rgba(
            input,
            2,
            1,
            0x4785b5,
            0xcccb9e,
            0xbedc8a,
            0xdccb9e,
            0xe6e6e6,
        );
        assert_ne!(output, 0);
        assert_eq!(openfront_upload_len(output), 8);

        UPLOADS.with(|uploads| {
            let uploads = uploads.borrow();
            let bytes = uploads[slot_index(output).unwrap()].as_ref().unwrap();
            assert_eq!(bytes.as_slice(), &[71, 133, 181, 255, 190, 210, 138, 255]);
        });
    }

    #[test]
    fn terrain_rgba_export_rejects_wrong_dimensions() {
        UPLOADS.with(|uploads| uploads.borrow_mut().clear());
        begin_call();

        let input = openfront_upload_create(1);
        assert_eq!(
            openfront_graphics_terrain_rgba(
                input,
                2,
                1,
                0x4785b5,
                0xcccb9e,
                0xbedc8a,
                0xdccb9e,
                0xe6e6e6,
            ),
            0
        );
        assert_eq!(openfront_last_error(), ErrorCode::TerrainLengthMismatch as u32);
    }
}
