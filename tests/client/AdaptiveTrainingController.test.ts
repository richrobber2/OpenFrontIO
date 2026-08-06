import { beforeEach, describe, expect, it } from "vitest";
import {
  AdaptiveActionGate,
  LearningCheckpointStore,
} from "../../src/client/ai/AdaptiveTrainingController";

const signature = {
  tick: 100,
  gold: 50_000,
  troops: 20_000,
  tiles: 2_000,
  units: 5,
  incomingFronts: 0,
  outgoingFronts: 0,
};

describe("AdaptiveActionGate", () => {
  it("allows repeated actions when slots remain and the world changes", () => {
    const gate = new AdaptiveActionGate();
    const context = {
      signature,
      pendingIntentCount: 0,
      availableActionSlots: 3,
      affordableUsefulActions: 3,
    };

    expect(gate.canAct(context)).toBe(true);
    gate.recordAction(signature);
    expect(gate.canAct(context)).toBe(true);
    gate.recordAction(signature);
    expect(gate.canAct(context)).toBe(true);
    gate.recordAction(signature);
    expect(gate.canAct(context)).toBe(false);

    expect(
      gate.canAct({
        ...context,
        signature: { ...signature, gold: 40_000, units: 6 },
      }),
    ).toBe(true);
  });

  it("waits while an intent is pending", () => {
    const gate = new AdaptiveActionGate();
    expect(
      gate.canAct({
        signature,
        pendingIntentCount: 1,
        availableActionSlots: 4,
        affordableUsefulActions: 4,
      }),
    ).toBe(false);
  });

  it("does not act without useful affordable actions", () => {
    const gate = new AdaptiveActionGate();
    expect(
      gate.canAct({
        signature,
        pendingIntentCount: 0,
        availableActionSlots: 4,
        affordableUsefulActions: 0,
      }),
    ).toBe(false);
  });
});

describe("LearningCheckpointStore", () => {
  beforeEach(() => localStorage.clear());

  it("persists checkpoints and rewinds to the previous state", () => {
    const store = new LearningCheckpointStore<{ aggression: number }>({
      storageKey: "test.checkpoints",
      maxCheckpoints: 4,
    });

    store.save({ aggression: 0.2 }, { score: 10, matches: 1, label: "base" });
    store.save({ aggression: 0.4 }, { score: 12, matches: 2, label: "better" });

    expect(store.latest()?.state.aggression).toBe(0.4);
    expect(store.rewind()?.aggression).toBe(0.2);
    expect(store.rewindToBest()?.aggression).toBe(0.4);
  });

  it("keeps only the configured number of checkpoints", () => {
    const store = new LearningCheckpointStore<{ value: number }>({
      storageKey: "test.bounded",
      maxCheckpoints: 2,
    });

    store.save({ value: 1 }, { score: 1, matches: 1, label: "one" });
    store.save({ value: 2 }, { score: 2, matches: 2, label: "two" });
    store.save({ value: 3 }, { score: 3, matches: 3, label: "three" });

    expect(store.list()).toHaveLength(2);
    expect(store.list().map((entry) => entry.state.value)).toEqual([2, 3]);
  });

  it("checkpoints only meaningful score improvements", () => {
    const store = new LearningCheckpointStore<{ value: number }>({
      storageKey: "test.score",
      minimumScoreImprovement: 0.5,
    });

    expect(store.shouldCheckpoint(1)).toBe(true);
    store.save({ value: 1 }, { score: 1, matches: 1, label: "base" });
    expect(store.shouldCheckpoint(1.2)).toBe(false);
    expect(store.shouldCheckpoint(1.5)).toBe(true);
  });
});
