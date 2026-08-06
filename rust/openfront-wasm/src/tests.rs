#[cfg(test)]
mod tests {
    use super::*;
    use openfront_core::TERRAIN_LAND_MASK;

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
    fn reports_invalid_masks_without_corrupting_the_map() {
        reset();
        let map = create_map(2, 1, &[0, 0]);
        let mask = openfront_upload_create(1);

        assert_eq!(openfront_map_connected_mask(map, 0, mask), 0);
        assert_eq!(
            openfront_last_error(),
            ErrorCode::MaskLengthMismatch as u32
        );
        assert_eq!(openfront_map_tile_count(map), 2);
    }
}
