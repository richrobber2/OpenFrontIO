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

`openfront-wasm` exposes the proven core through a dependency-free WebAssembly
ABI:

- bulk terrain and traversal-mask uploads through linear memory
- stable map handles and explicit error codes
- packed tile reads and updates
- cardinal and diagonal neighbor queries
- owner and mask based connected-region traversal
- a typed browser wrapper in `src/client/rust/OpenFrontWasm.ts`

The TypeScript implementation remains authoritative while this boundary is
validated against live games and replay data.

## Local checks

```sh
cargo fmt --all --check
cargo test --workspace
cargo check --workspace
cargo check --package openfront-wasm --target wasm32-unknown-unknown
```

Rust-only changes are also checked by `.github/workflows/rust.yml`.

## Build the browser module

Install the `wasm32-unknown-unknown` standard library for your Rust toolchain,
then run:

```sh
node scripts/build-rust-wasm.mjs
```

The script writes `resources/wasm/openfront_wasm.wasm`. Vite serves that file at
`/wasm/openfront_wasm.wasm`, which is the default URL used by
`OpenFrontWasmModule.load()`.

## Next slice

Add a parity harness that runs the same map update and traversal traces through
TypeScript and WebAssembly, then compare every packed tile and counter. Rendering
and networking remain in TypeScript.
