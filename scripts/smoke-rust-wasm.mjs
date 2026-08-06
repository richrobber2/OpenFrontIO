import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(
  root,
  "resources",
  "wasm",
  "openfront_wasm.wasm",
);
const wasmBytes = await readFile(wasmPath);
const wasmStat = await stat(wasmPath);
assert.ok(wasmStat.size > 0, "generated Wasm binary is empty");

const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const wasm = instance.exports;
const INVALID_RESULT = 0xffff_ffff;

function exportedFunction(name) {
  const value = wasm[name];
  assert.equal(typeof value, "function", `missing Wasm export ${name}`);
  return value;
}

function call(name, ...args) {
  return exportedFunction(name)(...args) >>> 0;
}

function resultTiles() {
  const pointer = call("openfront_result_ptr");
  const length = call("openfront_result_len");
  return Array.from(new Uint32Array(wasm.memory.buffer, pointer, length));
}

function upload(bytes) {
  const handle = call("openfront_upload_create", bytes.length);
  assert.notEqual(handle, 0, "upload allocation failed");
  const pointer = call("openfront_upload_ptr", handle);
  assert.equal(call("openfront_upload_len", handle), bytes.length);
  new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
  return handle;
}

assert.ok(
  wasm.memory instanceof WebAssembly.Memory,
  "Wasm memory is not exported",
);
assert.equal(call("openfront_abi_version"), 1);
assert.equal(call("openfront_invalid_result"), INVALID_RESULT);

const land = 0x80 | 1;
const terrainUpload = upload(Uint8Array.of(land, land, land, 0));
const map = call("openfront_map_create", 2, 2, terrainUpload);
assert.notEqual(map, 0, "map creation failed");
assert.equal(call("openfront_map_width", map), 2);
assert.equal(call("openfront_map_height", map), 2);
assert.equal(call("openfront_map_tile_count", map), 4);
assert.equal(call("openfront_map_num_land_tiles", map), 3);

assert.equal(call("openfront_map_set_owner_id", map, 0, 7), 1);
assert.equal(call("openfront_map_set_owner_id", map, 1, 7), 1);
assert.equal(call("openfront_map_set_owner_id", map, 2, 9), 1);
assert.equal(call("openfront_map_set_fallout", map, 0, 1), 1);
assert.equal(call("openfront_map_set_defense_bonus", map, 0, 1), 1);
assert.equal(call("openfront_map_num_tiles_with_fallout", map), 1);

const packed = call("openfront_map_packed_tile", map, 0);
assert.notEqual(packed, INVALID_RESULT);
assert.equal(packed & 0x0fff, 7);
assert.notEqual(packed & (1 << 13), 0);
assert.notEqual(packed & (1 << 14), 0);

assert.equal(call("openfront_map_neighbors4", map, 0), 1);
assert.deepEqual(resultTiles(), [2, 1]);
assert.equal(call("openfront_map_neighbors8", map, 0), 1);
assert.deepEqual(resultTiles(), [2, 1, 3]);

assert.equal(call("openfront_map_connected_owner", map, 0), 1);
assert.deepEqual(resultTiles(), [0, 1]);

const maskUpload = upload(Uint8Array.of(1, 1, 0, 0));
assert.equal(call("openfront_map_connected_mask", map, 0, maskUpload), 1);
assert.deepEqual(resultTiles(), [0, 1]);
assert.equal(call("openfront_upload_destroy", maskUpload), 1);

assert.equal(call("openfront_map_destroy", map), 1);
assert.equal(call("openfront_map_width", map), INVALID_RESULT);
assert.equal(call("openfront_last_error"), 1);

console.log(`OpenFront Wasm smoke test passed (${wasmStat.size} bytes)`);
