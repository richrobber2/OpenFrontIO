use openfront_core::{
    BoundedWaterPathFinder, Coord, GameMapStore, SearchBounds, TileRef, TERRAIN_LAND_MASK,
};

fn tile(map: &GameMapStore, x: u32, y: u32) -> TileRef {
    map.tile_ref(Coord::new(x, y)).unwrap()
}

#[test]
fn bounded_water_routes_inside_requested_rectangle() {
    let width = 9;
    let height = 7;
    let mut terrain = vec![5_u8; (width * height) as usize];
    for y in 1..6 {
        if y != 5 {
            terrain[(y * width + 4) as usize] = TERRAIN_LAND_MASK | 1;
        }
    }
    let map = GameMapStore::new(width, height, terrain).unwrap();
    let start = tile(&map, 1, 3);
    let goal = tile(&map, 7, 3);
    let bounds = SearchBounds {
        min_x: 1,
        max_x: 7,
        min_y: 1,
        max_y: 5,
    };
    let mut finder = BoundedWaterPathFinder::new(35);
    let path = finder
        .search_bounded(&map, &[start], goal, bounds)
        .unwrap()
        .unwrap();

    assert_eq!(path.first(), Some(&start));
    assert_eq!(path.last(), Some(&goal));
    for step in path {
        let coord = map.coord(step).unwrap();
        assert!((1..=7).contains(&coord.x));
        assert!((1..=5).contains(&coord.y));
        if step != goal {
            assert!(!map.terrain(step).unwrap().is_land());
        }
    }
}

#[test]
fn bounded_water_returns_none_when_scratch_is_too_small() {
    let map = GameMapStore::new(10, 10, vec![5_u8; 100]).unwrap();
    let mut finder = BoundedWaterPathFinder::new(16);
    let result = finder
        .search_bounded(
            &map,
            &[tile(&map, 0, 0)],
            tile(&map, 9, 9),
            SearchBounds {
                min_x: 0,
                max_x: 9,
                min_y: 0,
                max_y: 9,
            },
        )
        .unwrap();
    assert!(result.is_none());

    finder.ensure_capacity(100);
    assert!(finder
        .search_bounded(
            &map,
            &[tile(&map, 0, 0)],
            tile(&map, 9, 9),
            SearchBounds {
                min_x: 0,
                max_x: 9,
                min_y: 0,
                max_y: 9,
            },
        )
        .unwrap()
        .is_some());
}

#[test]
fn bounded_water_matches_typescript_clamping_semantics() {
    let map = GameMapStore::new(8, 8, vec![5_u8; 64]).unwrap();
    let outside_start = tile(&map, 0, 0);
    let goal = tile(&map, 6, 6);
    let bounds = SearchBounds {
        min_x: 2,
        max_x: 6,
        min_y: 2,
        max_y: 6,
    };
    let mut finder = BoundedWaterPathFinder::new(25);
    let path = finder
        .search_bounded(&map, &[outside_start], goal, bounds)
        .unwrap()
        .unwrap();

    // TypeScript clamps an out-of-bounds start into the search rectangle.
    assert_eq!(path.first(), Some(&tile(&map, 2, 2)));
    assert_eq!(path.last(), Some(&goal));
}
