export class TileDripQueue {
  private readonly buckets: number[][];
  private readonly pending: Uint8Array;
  private currentBucket = 0;
  private queued = 0;

  constructor(tileCount: number, bucketCount: number) {
    if (!Number.isInteger(tileCount) || tileCount < 0) {
      throw new Error(`Invalid tile count: ${tileCount}`);
    }
    const count = Math.max(1, bucketCount | 0);
    this.buckets = Array.from({ length: count }, () => []);
    this.pending = new Uint8Array(tileCount);
  }

  enqueue(ref: number): boolean {
    if (!Number.isInteger(ref) || ref < 0 || ref >= this.pending.length) {
      return false;
    }
    if (this.pending[ref] !== 0) return false;

    this.pending[ref] = 1;
    const bucket = ((ref * 2654435761) >>> 0) % this.buckets.length;
    this.buckets[bucket].push(ref);
    this.queued++;
    return true;
  }

  drainNext(visit: (ref: number) => void): number {
    const bucket = this.buckets[this.currentBucket];
    const count = bucket.length;
    for (let i = 0; i < count; i++) {
      const ref = bucket[i];
      this.pending[ref] = 0;
      visit(ref);
    }
    bucket.length = 0;
    this.queued -= count;
    this.currentBucket = (this.currentBucket + 1) % this.buckets.length;
    return count;
  }

  drainAll(visit: (ref: number) => void): number {
    const total = this.queued;
    for (const bucket of this.buckets) {
      for (let i = 0; i < bucket.length; i++) {
        const ref = bucket[i];
        this.pending[ref] = 0;
        visit(ref);
      }
      bucket.length = 0;
    }
    this.queued = 0;
    return total;
  }

  clear(): void {
    for (const bucket of this.buckets) {
      for (let i = 0; i < bucket.length; i++) {
        this.pending[bucket[i]] = 0;
      }
      bucket.length = 0;
    }
    this.currentBucket = 0;
    this.queued = 0;
  }

  size(): number {
    return this.queued;
  }
}
