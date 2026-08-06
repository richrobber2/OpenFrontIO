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
- multi-source FIFO owned-land depths matching the AI's
  `interiorBuildCandidates` helper

`openfront-wasm` exposes the proven core through a dependency-free WebAssembly
ABI:

- bulk terrain, traversal-mask, and tile-list uploads through linear memory
- stable map handles and explicit error codes
- packed tile reads and updates
- cardinal and diagonal neighbor queries
- owner and mask based connected-region traversal
- flat `[tile, depth]` owned-interior query results
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
npx vitest run tests/rust
```

Rust changes are also checked by `.github/workflows/rust.yml`. The workflow
builds the actual browser module, runs the raw ABI smoke test, checks TypeScript,
and executes the deterministic and shadow parity harnesses.

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

The smoke test instantiates the module, writes terrain, traversal masks, and tile
lists into linear memory, exercises map mutation and query exports, checks packed
state and counters, and validates invalid-handle error reporting.

## TypeScript and Rust parity

The deterministic parity tests run the same map operations through
`GameMapImpl` and WebAssembly and compare every tile, counter, neighbor result,
traversal result, and owned-interior depth result:

```sh
npx vitest run tests/rust
```

`RustMapShadow` is the reusable bridge for production-shaped validation. It
initializes Rust from an authoritative `GameMap`, consumes `GameImpl`'s exact
`[tile, packedValue]` update pairs, checks touched tiles and counters after each
batch, and can perform full-map checkpoints. It never changes TypeScript state.

## One-command headless validation

Run a deterministic local game without a server, browser, archive, or game ID:

```sh
node scripts/test-rust-shadow.mjs
```

The command builds WebAssembly and runs a 300-tick World game with 32 bots. Rust
consumes every real packed map-update batch. At each full-map checkpoint the
harness also chooses the largest current territory and compares Rust's
multi-source owned-depth result against the existing TypeScript AI algorithm.

Longer runs can override the defaults:

```sh
node scripts/test-rust-shadow.mjs \
  --ticks 1000 \
  --bots 64 \
  --checkpoint-every 100 \
  --seed rust-shadow-long
```

## Replay shadow mode

For historical compatibility checks, build the WebAssembly module and pass
`--rust-shadow` to the existing replay command:

```sh
node scripts/build-rust-wasm.mjs
npm run replay:game -- <gameID-or-record.json> --rust-shadow
```

The replay remains authoritative in TypeScript. Rust consumes the real packed
map-update stream, checks touched tiles and counters after every tick, and checks
the full map at recorded hash checkpoints and after the final turn. A Rust
mismatch exits nonzero with the first failing checkpoint and tile or counter.

## Next slice

Measure the owned-depth query against the current TypeScript implementation,
then route AI interior-building candidate generation through the Rust result
behind an opt-in runtime flag. Rendering, networking, and authoritative
simulation remain in TypeScript.
