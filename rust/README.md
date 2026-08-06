# OpenFront Rust port

The Rust port is being introduced as deterministic, testable slices rather than
as a second implementation of the entire game.

## Current slice

`openfront-core::geometry` mirrors the pure grid behavior from
`src/core/game/GameMap.ts`:

- row-major tile references
- coordinate validation and conversion
- cardinal neighbors in north, south, west, east order
- Manhattan and squared Euclidean distance
- circle enumeration in the same x-major order

The TypeScript implementation remains authoritative until parity tests and a
binding layer allow callers to switch safely.

## Local checks

```sh
cargo fmt --all --check
cargo test --workspace
cargo check --workspace
```

## Next slice

Port packed terrain/state bit operations, then expose both geometry and tile
state through a narrow WebAssembly boundary. Rendering and networking stay in
TypeScript until the deterministic core is proven equivalent.
