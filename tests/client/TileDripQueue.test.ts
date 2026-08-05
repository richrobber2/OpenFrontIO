import { describe, expect, test, vi } from "vitest";
import { TileDripQueue } from "../../src/client/render/gl/utils/TileDripQueue";

describe("TileDripQueue", () => {
  test("coalesces repeated updates to a pending tile", () => {
    const queue = new TileDripQueue(128, 4);

    expect(queue.enqueue(17)).toBe(true);
    expect(queue.enqueue(17)).toBe(false);
    expect(queue.enqueue(17)).toBe(false);
    expect(queue.size()).toBe(1);

    const visited: number[] = [];
    for (let i = 0; i < 4; i++) queue.drainNext((ref) => visited.push(ref));

    expect(visited).toEqual([17]);
    expect(queue.size()).toBe(0);
  });

  test("allows a tile to be queued again after its bucket drains", () => {
    const queue = new TileDripQueue(64, 1);
    const visit = vi.fn();

    queue.enqueue(9);
    queue.drainNext(visit);
    queue.enqueue(9);
    queue.drainNext(visit);

    expect(visit).toHaveBeenCalledTimes(2);
    expect(visit).toHaveBeenNthCalledWith(1, 9);
    expect(visit).toHaveBeenNthCalledWith(2, 9);
  });

  test("drainAll visits every unique pending tile and resets the queue", () => {
    const queue = new TileDripQueue(256, 8);
    for (const ref of [3, 11, 87, 3, 11, 200]) queue.enqueue(ref);

    const visited: number[] = [];
    expect(queue.drainAll((ref) => visited.push(ref))).toBe(4);
    expect(visited.sort((a, b) => a - b)).toEqual([3, 11, 87, 200]);
    expect(queue.size()).toBe(0);
  });

  test("clear removes pending membership without visiting tiles", () => {
    const queue = new TileDripQueue(32, 3);
    queue.enqueue(4);
    queue.enqueue(12);
    queue.clear();

    expect(queue.size()).toBe(0);
    expect(queue.enqueue(4)).toBe(true);
  });

  test("rejects invalid refs", () => {
    const queue = new TileDripQueue(8, 2);

    expect(queue.enqueue(-1)).toBe(false);
    expect(queue.enqueue(8)).toBe(false);
    expect(queue.enqueue(1.5)).toBe(false);
    expect(queue.size()).toBe(0);
  });
});
