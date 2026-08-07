#[cfg(test)]
mod tests {
    use super::*;
    use openfront_core::{
        UnitKind, TERRAIN_LAND_MASK, UNIT_CLASS_ATTACK_RING, UNIT_CLASS_LIGHT,
        UNIT_CLASS_MOBILE, UNIT_CLASS_STRUCTURE, UNIT_CLASS_TRAIL,
    };

    fn reset() {
        MAPS.with(|maps| maps.borrow_mut().clear());
        UPLOADS.with(|uploads| uploads.borrow_mut().clear());
        RESULT.with(|result| result.borrow_mut().clear());
        begin_call();
    }

    fn create_map(width: u32, height: u32, terrain: &[u8]) -> u32 {
        let upload = openfront_upload_create(terrain.len() as u32);
        for (index, byte) in terrain.iter().copied().enumerate() {
            assert_eq!(openfront_upload_set(upload, index as u32, byte.into()), 1);
        }
        openfront_map_create(width, height, upload)
    }

    fn upload_u32s(values: &[u32]) -> u32 {
        let upload = openfront_upload_create((values.len() * 4) as u32);
        for (value_index, value) in values.iter().copied().enumerate() {
            for (byte_index, byte) in value.to_le_bytes().into_iter().enumerate() {
                assert_eq!(
                    openfront_upload_set(
                        upload,
                        (value_index * 4 + byte_index) as u32,
                        byte.into(),
                    ),
                    1
                );
            }
        }
        upload
    }

    fn uploaded_u32s(handle: u32) -> Vec<u32> {
        UPLOADS.with(|uploads| {
            let uploads = uploads.borrow();
            let bytes = uploads[(handle - 1) as usize].as_ref().unwrap();
            bytes
                .chunks_exact(4)
                .map(|word| u32::from_le_bytes([word[0], word[1], word[2], word[3]]))
                .collect()
        })
    }

    #[test]
    fn creates_updates_and_destroys_maps() {
        reset();
        let land = TERRAIN_LAND_MASK | 1;
        let map = create_map(2, 2, &[land, 0, land, 0]);

        assert_ne!(map, 0);
        assert_eq!(openfront_map_width(map), 2);
        assert_eq!(openfront_map_height(map), 2);
        assert_eq!(openfront_map_num_land_tiles(map), 2);
        assert_eq!(openfront_map_set_owner_id(map, 0, 7), 1);
        assert_eq!(openfront_map_set_fallout(map, 0, 1), 1);
        assert_eq!(openfront_map_num_tiles_with_fallout(map), 1);

        let packed = openfront_map_packed_tile(map, 0);
        assert_ne!(packed, INVALID_RESULT);
        assert_eq!(packed & 0x0fff, 7);

        assert_eq!(openfront_map_destroy(map), 1);
        assert_eq!(openfront_map_width(map), INVALID_RESULT);
        assert_eq!(openfront_last_error(), ErrorCode::InvalidHandle as u32);
    }

    #[test]
    fn classifies_batched_unit_records_in_place() {
        reset();
        let upload = upload_u32s(&[
            101,
            UnitKind::Transport as u32,
            1,
            202,
            UnitKind::City as u32,
            1,
            303,
            UnitKind::AtomBomb as u32,
            0,
        ]);

        assert_eq!(openfront_units_classify(upload, 3), 1);
        let words = uploaded_u32s(upload);
        assert_eq!(words[0], 101);
        assert_eq!(words[1], UnitKind::Transport as u32);
        assert_eq!(
            words[2],
            UNIT_CLASS_MOBILE | UNIT_CLASS_TRAIL | UNIT_CLASS_ATTACK_RING | UNIT_CLASS_LIGHT
        );
        assert_eq!(words[3], 202);
        assert_eq!(words[4], UnitKind::City as u32);
        assert_eq!(words[5], UNIT_CLASS_STRUCTURE | UNIT_CLASS_LIGHT);
        assert_eq!(words[6], 303);
        assert_eq!(words[7], UnitKind::AtomBomb as u32);
        assert_eq!(words[8], 0);

        let short = upload_u32s(&[1, UnitKind::Transport as u32]);
        assert_eq!(openfront_units_classify(short, 1), 0);
        assert_eq!(
            openfront_last_error(),
            ErrorCode::UnitRecordLengthMismatch as u32
        );
    }

    #[test]
    fn neighbors_and_connected_queries_share_the_result_buffer() {
        reset();
        let land = TERRAIN_LAND_MASK | 1;
        let map = create_map(3, 1, &[land, land, land]);
        assert_ne!(map, 0);

        assert_eq!(openfront_map_set_owner_id(map, 0, 4), 1);
        assert_eq!(openfront_map_set_owner_id(map, 1, 4), 1);
        assert_eq!(openfront_map_set_owner_id(map, 2, 9), 1);

        assert_eq!(openfront_map_neighbors4(map, 1), 1);
        assert_eq!(openfront_result_len(), 2);

        assert_eq!(openfront_map_connected_owner(map, 0), 1);
        RESULT.with(|result| assert_eq!(result.borrow().as_slice(), &[0, 1]));

        let mask = openfront_upload_create(3);
        assert_eq!(openfront_upload_set(mask, 1, 1), 1);
        assert_eq!(openfront_upload_set(mask, 2, 1), 1);
        assert_eq!(openfront_map_connected_mask(map, 1, mask), 1);
        RESULT.with(|result| assert_eq!(result.borrow().as_slice(), &[1, 2]));
    }

    #[test]
    fn owned_depths_returns_flat_tile_depth_pairs() {
        reset();
        let land = TERRAIN_LAND_MASK | 1;
        let map = create_map(4, 1, &[land; 4]);
        for tile in 0..4 {
            assert_eq!(openfront_map_set_owner_id(map, tile, 7), 1);
        }
        assert_eq!(openfront_map_set_owner_id(map, 2, 9), 1);

        let starts = upload_u32s(&[0, 0]);
        assert_eq!(openfront_map_owned_depths(map, starts, 7, 10), 1);
        RESULT.with(|result| assert_eq!(result.borrow().as_slice(), &[0, 0, 1, 1]));

        assert_eq!(openfront_map_owned_depths(map, starts, 0x1000, 10), 0);
        assert_eq!(
            openfront_last_error(),
            ErrorCode::OwnerIdOutOfRange as u32
        );
    }

    #[test]
    fn reports_invalid_query_uploads_without_corrupting_the_map() {
        reset();
        let map = create_map(2, 1, &[0, 0]);
        let mask = openfront_upload_create(1);

        assert_eq!(openfront_map_connected_mask(map, 0, mask), 0);
        assert_eq!(
            openfront_last_error(),
            ErrorCode::MaskLengthMismatch as u32
        );

        assert_eq!(openfront_map_owned_depths(map, mask, 0, 1), 0);
        assert_eq!(
            openfront_last_error(),
            ErrorCode::TileListLengthMismatch as u32
        );
        assert_eq!(openfront_map_tile_count(map), 2);
    }
}
