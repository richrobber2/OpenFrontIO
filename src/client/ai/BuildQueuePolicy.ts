export type QueuedBuildingKind =
  | "city"
  | "factory"
  | "port"
  | "defense-post"
  | "sam"
  | "silo";

export interface BuildQueueCandidate {
  id: string;
  kind: QueuedBuildingKind;
  cost: number;
  strategicScore: number;
  conflictGroup?: string;
  blocksCandidateIDs?: string[];
  stackGroup?: string;
  stackOrdinal?: number;
  marginalStackScore?: number;
}

export interface BuildQueueContext {
  gold: number;
  emergencyGoldFloor: number;
  maximumQueuedPlacements: number;
  actionCapacity: number;
  allowProductiveStacking?: boolean;
  maximumPerStackGroup?: number;
  minimumMarginalStackScore?: number;
  candidates: BuildQueueCandidate[];
}

export interface BuildQueuePlan {
  queued: BuildQueueCandidate[];
  committedGold: number;
  remainingGold: number;
  reason: string;
}

/**
 * Selects several affordable placements for one decision cycle. Candidates may
 * deliberately share a stack group when stacking is enabled and each additional
 * building still has positive marginal value.
 */
export function planBuildQueue(context: BuildQueueContext): BuildQueuePlan {
  const reserve = Math.max(0, context.emergencyGoldFloor);
  const initialBudget = Math.max(0, context.gold - reserve);
  const queueLimit = Math.max(
    0,
    Math.min(
      Math.floor(context.maximumQueuedPlacements),
      Math.floor(context.actionCapacity),
    ),
  );
  const allowStacking = context.allowProductiveStacking ?? false;
  const maximumPerStackGroup = Math.max(1, context.maximumPerStackGroup ?? 1);
  const minimumMarginalStackScore = context.minimumMarginalStackScore ?? 0;

  if (initialBudget <= 0 || queueLimit === 0) {
    return {
      queued: [],
      committedGold: 0,
      remainingGold: context.gold,
      reason: "no disposable gold or action capacity for a construction batch",
    };
  }

  const ranked = [...context.candidates]
    .filter((candidate) => candidate.cost > 0)
    .filter((candidate) => candidate.strategicScore > 0)
    .filter(
      (candidate) =>
        candidate.stackOrdinal === undefined ||
        candidate.stackOrdinal <= 1 ||
        (allowStacking &&
          (candidate.marginalStackScore ?? candidate.strategicScore) >=
            minimumMarginalStackScore),
    )
    .sort(
      (a, b) =>
        b.strategicScore / b.cost - a.strategicScore / a.cost ||
        b.strategicScore - a.strategicScore ||
        a.cost - b.cost,
    );

  const queued: BuildQueueCandidate[] = [];
  const usedConflictGroups = new Set<string>();
  const stackCounts = new Map<string, number>();
  const blockedIDs = new Set<string>();
  let available = initialBudget;

  for (const candidate of ranked) {
    if (queued.length >= queueLimit) break;
    if (blockedIDs.has(candidate.id)) continue;

    const stackCount =
      candidate.stackGroup === undefined
        ? 0
        : (stackCounts.get(candidate.stackGroup) ?? 0);
    const isAdditionalStack = candidate.stackGroup !== undefined && stackCount > 0;

    if (
      candidate.conflictGroup !== undefined &&
      usedConflictGroups.has(candidate.conflictGroup) &&
      !(allowStacking && isAdditionalStack)
    ) {
      continue;
    }
    if (isAdditionalStack && (!allowStacking || stackCount >= maximumPerStackGroup)) {
      continue;
    }
    if (
      isAdditionalStack &&
      (candidate.marginalStackScore ?? candidate.strategicScore) <
        minimumMarginalStackScore
    ) {
      continue;
    }
    if (candidate.cost > available) continue;

    queued.push(candidate);
    available -= candidate.cost;
    if (candidate.conflictGroup !== undefined) {
      usedConflictGroups.add(candidate.conflictGroup);
    }
    if (candidate.stackGroup !== undefined) {
      stackCounts.set(candidate.stackGroup, stackCount + 1);
    }
    for (const blockedID of candidate.blocksCandidateIDs ?? []) {
      blockedIDs.add(blockedID);
    }
  }

  const committedGold = initialBudget - available;
  return {
    queued,
    committedGold,
    remainingGold: context.gold - committedGold,
    reason:
      queued.length === 0
        ? "no useful placements fit the disposable treasury"
        : `queue ${queued.length} building placement${queued.length === 1 ? "" : "s"}${allowStacking ? " with productive stacking allowed" : ""}`,
  };
}
