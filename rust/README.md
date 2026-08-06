# OpenFront Rust port

The Rust port is being introduced as deterministic, testable slices rather than
as a second implementation of the entire game.

## Current slices

`openfront-core::geometry` mirrors the pure grid behavior from
`src/core/game/GameMap.ts`:

- row-major tile references
- coordinate validation and conversion
- cardinal neighbors in north, south, west, east order
- Manhattan and squared Euclidean distance
- circle enumeration in the same x-major order

`openfront-core::tile` mirrors the packed map representation:

- terrain land, shoreline, ocean, and magnitude bits
- terrain classification, movement cost, and impassable handling
- 12-bit owner IDs plus fallout and defense flags
- packed 32-bit tile updates and exact land/fallout counter deltas

`openfront-core::map` combines those primitives into contiguous map storage:

- validated terrain and state buffers
- internally derived land and fallout counters
- packed updates that keep counters synchronized
- edge, border, and ocean-shore checks
- zero-allocation cardinal-neighbor access

`openfront-core::traversal` ports deterministic traversal behavior:

- fixed-capacity diagonal-neighbor access in TypeScript iteration order
- filtered connected-region search
- exact compatibility with the existing `bfs` method's LIFO insertion order

The TypeScript implementation remains authoritative until parity tests and a
binding layer allow callers to switch safely.

## Local checks

```sh
cargo fmt --all --check
cargo test --workspace
cargo check --workspace
```

Rust-only changes are also checked by `.github/workflows/rust.yml`.

## Next slice

Expose the proven geometry, tile, map, and traversal operations through a narrow
WebAssembly boundary. Rendering and networking remain in TypeScript.
