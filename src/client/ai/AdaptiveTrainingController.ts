export interface AdaptiveWorldSignature {
  tick: number;
  gold: number;
  troops: number;
  tiles: number;
  units: number;
  incomingFronts: number;
  outgoingFronts: number;
}

export interface AdaptiveActionContext {
  signature: AdaptiveWorldSignature;
  pendingIntentCount: number;
  availableActionSlots: number;
  affordableUsefulActions: number;
}

export interface LearningCheckpoint<T> {
  id: string;
  createdAt: number;
  score: number;
  matches: number;
  label: string;
  state: T;
}

const signatureKey = (signature: AdaptiveWorldSignature): string =>
  [
    signature.gold,
    signature.troops,
    signature.tiles,
    signature.units,
    signature.incomingFronts,
    signature.outgoingFronts,
  ].join(":");

/**
 * Replaces fixed tick cooldowns with state-based gating. The trainer may issue
 * another action immediately after the world changes, but it will not emit the
 * same intent repeatedly while the previous request is still pending.
 */
export class AdaptiveActionGate {
  private lastSignature = "";
  private actionsForSignature = 0;

  public reset(): void {
    this.lastSignature = "";
    this.actionsForSignature = 0;
  }

  public canAct(context: AdaptiveActionContext): boolean {
    if (context.pendingIntentCount > 0) return false;
    if (context.availableActionSlots <= 0) return false;
    if (context.affordableUsefulActions <= 0) return false;

    const currentSignature = signatureKey(context.signature);
    if (currentSignature !== this.lastSignature) {
      this.lastSignature = currentSignature;
      this.actionsForSignature = 0;
    }

    return this.actionsForSignature < context.availableActionSlots;
  }

  public recordAction(signature: AdaptiveWorldSignature): void {
    const currentSignature = signatureKey(signature);
    if (currentSignature !== this.lastSignature) {
      this.lastSignature = currentSignature;
      this.actionsForSignature = 0;
    }
    this.actionsForSignature++;
  }
}

export interface CheckpointStoreOptions {
  storageKey: string;
  maxCheckpoints?: number;
  minimumScoreImprovement?: number;
}

/**
 * Persists bounded learning snapshots, supports rewind, and avoids replacing a
 * good brain with a clearly worse mutation after one noisy match.
 */
export class LearningCheckpointStore<T> {
  private readonly maxCheckpoints: number;
  private readonly minimumScoreImprovement: number;

  public constructor(private readonly options: CheckpointStoreOptions) {
    this.maxCheckpoints = Math.max(2, options.maxCheckpoints ?? 12);
    this.minimumScoreImprovement = options.minimumScoreImprovement ?? 0.01;
  }

  public list(): LearningCheckpoint<T>[] {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(this.options.storageKey) ?? "[]",
      );
      return Array.isArray(parsed) ? (parsed as LearningCheckpoint<T>[]) : [];
    } catch {
      return [];
    }
  }

  public latest(): LearningCheckpoint<T> | null {
    const checkpoints = this.list();
    return checkpoints[checkpoints.length - 1] ?? null;
  }

  public best(): LearningCheckpoint<T> | null {
    return this.list().reduce<LearningCheckpoint<T> | null>(
      (best, checkpoint) =>
        best === null || checkpoint.score > best.score ? checkpoint : best,
      null,
    );
  }

  public save(
    state: T,
    metadata: { score: number; matches: number; label: string },
  ): LearningCheckpoint<T> {
    const checkpoints = this.list();
    const checkpoint: LearningCheckpoint<T> = {
      id: `${Date.now()}-${metadata.matches}`,
      createdAt: Date.now(),
      score: metadata.score,
      matches: metadata.matches,
      label: metadata.label,
      state: structuredClone(state),
    };

    checkpoints.push(checkpoint);
    checkpoints.sort((a, b) => a.createdAt - b.createdAt);
    const bounded = checkpoints.slice(-this.maxCheckpoints);
    localStorage.setItem(this.options.storageKey, JSON.stringify(bounded));
    return checkpoint;
  }

  public shouldCheckpoint(score: number): boolean {
    const latest = this.latest();
    if (latest === null) return true;
    return score >= latest.score + this.minimumScoreImprovement;
  }

  public rewind(id?: string): T | null {
    const checkpoints = this.list();
    const checkpoint =
      id === undefined
        ? (checkpoints[checkpoints.length - 2] ??
          checkpoints[checkpoints.length - 1])
        : checkpoints.find((candidate) => candidate.id === id);
    return checkpoint === undefined ? null : structuredClone(checkpoint.state);
  }

  public rewindToBest(): T | null {
    const checkpoint = this.best();
    return checkpoint === null ? null : structuredClone(checkpoint.state);
  }

  public clear(): void {
    localStorage.removeItem(this.options.storageKey);
  }
}
