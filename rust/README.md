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
node scripts/build-rust-wasm.mjs
node scripts/smoke-rust-wasm.mjs
npx tsc --noEmit
npx vitest run tests/rust/GameMapParity.test.ts
```

Rust-only changes are also checked by `.github/workflows/rust.yml`. The workflow
builds the actual browser module, runs the raw ABI smoke test, checks TypeScript,
and executes the TypeScript/Rust parity harness.

## Build the browser module

Install the `wasm32-unknown-unknown` standard library for your Rust toolchain,
then run:

```sh
node scripts/build-rust-wasm.mjs
```

The script writes `resources/wasm/openfront_wasm.wasm`. Vite serves that file at
`/wasm/openfront_wasm.wasm`, which is the default URL used by
`OpenFrontWasmModule.load()`.

Run the generated binary through Node without browser or TypeScript mocks:

```sh
node scripts/smoke-rust-wasm.mjs
```

The smoke test instantiates the module, writes terrain and traversal masks into
linear memory, exercises map mutation and query exports, checks packed state and
counters, and validates invalid-handle error reporting.

## TypeScript and Rust parity

Build the browser module, then run:

```sh
npx vitest run tests/rust/GameMapParity.test.ts
```

The harness creates the same mixed-terrain map in `GameMapImpl` and WebAssembly,
applies explicit edge cases followed by a seeded 64-step mutation trace, and
checks the entire map after every operation. Each checkpoint compares packed
tiles, land and fallout counters, cardinal and diagonal neighbor order, connected
owner regions, and masked traversal results.

## Next slice

Feed replay-derived tile-update traces into the parity harness and add an
optional shadow-mode adapter that can compare TypeScript and WebAssembly during a
real match without changing authoritative game behavior. Rendering and
networking remain in TypeScript.
