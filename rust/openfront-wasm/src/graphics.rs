fn unpack_rgb(packed: u32) -> [u8; 3] {
    [
        ((packed >> 16) & 0xff) as u8,
        ((packed >> 8) & 0xff) as u8,
        (packed & 0xff) as u8,
    ]
}

fn terrain_graphics_error(error: TerrainGraphicsError) -> ErrorCode {
    match error {
        TerrainGraphicsError::SizeOverflow => ErrorCode::InvalidDimensions,
        TerrainGraphicsError::TerrainLengthMismatch { .. }
        | TerrainGraphicsError::DeltaRecordLengthMismatch { .. } => {
            ErrorCode::TerrainLengthMismatch
        }
        TerrainGraphicsError::InvalidTileRef { .. } => ErrorCode::InvalidTile,
    }
}

fn terrain_palette(
    ocean: u32,
    sand: u32,
    plains: u32,
    highland: u32,
    mountain: u32,
) -> TerrainPalette {
    TerrainPalette {
        ocean: unpack_rgb(ocean),
        sand: unpack_rgb(sand),
        plains: unpack_rgb(plains),
        highland: unpack_rgb(highland),
        mountain: unpack_rgb(mountain),
    }
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
    let palette = terrain_palette(ocean, sand, plains, highland, mountain);

    let result = UPLOADS.with(|uploads| {
        let mut uploads = uploads.borrow_mut();
        let index = slot_index(terrain_upload)?;
        let buffer = uploads.get_mut(index)?.as_mut()?;
        Some(build_terrain_rgba_in_place(buffer, width, height, palette))
    });

    let Some(result) = result else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    match result {
        Ok(()) => terrain_upload,
        Err(error) => {
            fail(terrain_graphics_error(error));
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_graphics_terrain_delta_records(
    upload: u32,
    count: u32,
    width: u32,
    height: u32,
    ocean: u32,
    sand: u32,
    plains: u32,
    highland: u32,
    mountain: u32,
) -> u32 {
    begin_call();
    let palette = terrain_palette(ocean, sand, plains, highland, mountain);

    let result = UPLOADS.with(|uploads| {
        let mut uploads = uploads.borrow_mut();
        let index = slot_index(upload)?;
        let buffer = uploads.get_mut(index)?.as_mut()?;
        Some(build_terrain_delta_records_in_place(
            buffer, count, width, height, palette,
        ))
    });

    let Some(result) = result else {
        fail(ErrorCode::InvalidHandle);
        return 0;
    };
    match result {
        Ok(()) => upload,
        Err(error) => {
            fail(terrain_graphics_error(error));
            0
        }
    }
}

#[cfg(test)]
mod graphics_tests {
    use super::*;

    #[test]
    fn terrain_rgba_export_expands_the_upload_buffer_in_place() {
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
        assert_eq!(output, input);
        assert_eq!(openfront_upload_len(input), 8);

        UPLOADS.with(|uploads| {
            let uploads = uploads.borrow();
            let bytes = uploads[slot_index(input).unwrap()].as_ref().unwrap();
            assert_eq!(bytes.as_slice(), &[71, 133, 181, 255, 190, 210, 138, 255]);
        });
    }

    #[test]
    fn terrain_delta_export_packs_ref_byte_and_rgba_in_place() {
        UPLOADS.with(|uploads| uploads.borrow_mut().clear());
        begin_call();

        let input = openfront_upload_create(16);
        let words = [0_u32, 0_u32, 3_u32, 0x85_u32];
        for (word_index, word) in words.into_iter().enumerate() {
            for (byte_index, byte) in word.to_le_bytes().into_iter().enumerate() {
                assert_eq!(
                    openfront_upload_set(input, (word_index * 4 + byte_index) as u32, byte as u32),
                    1
                );
            }
        }

        let output = openfront_graphics_terrain_delta_records(
            input,
            2,
            2,
            2,
            0x4785b5,
            0xcccb9e,
            0xbedc8a,
            0xdccb9e,
            0xe6e6e6,
        );
        assert_eq!(output, input);
        assert_eq!(openfront_upload_len(input), 24);

        UPLOADS.with(|uploads| {
            let uploads = uploads.borrow();
            let bytes = uploads[slot_index(input).unwrap()].as_ref().unwrap();
            let packed: Vec<u32> = bytes
                .chunks_exact(4)
                .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect();
            assert_eq!(
                packed,
                vec![
                    0,
                    0,
                    u32::from_le_bytes([71, 133, 181, 255]),
                    3,
                    0x85_u32,
                    u32::from_le_bytes([190, 210, 138, 255]),
                ]
            );
        });
    }

    #[test]
    fn terrain_rgba_export_rejects_wrong_dimensions_without_destroying_input() {
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
        assert_eq!(openfront_upload_len(input), 1);
    }
}
