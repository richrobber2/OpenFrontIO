import { WinUpdate } from "../../core/game/GameUpdates";
import { LearningCheckpointStore } from "./AdaptiveTrainingController";
import { VisualAiTrainer } from "./VisualAiTrainer";

type TrainerInternals = {
  nextBuildTick?: number;
  learning?: Record<string, number>;
};

type AdaptiveTrainerApi = {
  listCheckpoints: () => ReturnType<LearningCheckpointStore<Record<string, number>>["list"]>;
  rewindPrevious: () => boolean;
  rewindBest: () => boolean;
};

declare global {
  interface Window {
    openfrontAdaptiveTrainer?: AdaptiveTrainerApi;
  }
}

const CHECKPOINT_KEY = "openfront.visualAiLearning.checkpoints.v1";
const checkpointStore = new LearningCheckpointStore<Record<string, number>>({
  storageKey: CHECKPOINT_KEY,
  maxCheckpoints: 20,
  minimumScoreImprovement: 0.005,
});

let activeTrainer: TrainerInternals | null = null;

function cloneLearning(trainer: TrainerInternals): Record<string, number> | null {
  const learning = trainer.learning;
  if (learning === undefined) return null;
  return Object.fromEntries(
    Object.entries(learning).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function applyLearning(state: Record<string, number>): boolean {
  if (activeTrainer?.learning === undefined) return false;
  Object.assign(activeTrainer.learning, structuredClone(state));
  localStorage.setItem(
    "openfront.visualAiLearning.v1",
    JSON.stringify(activeTrainer.learning),
  );
  return true;
}

function learningScore(state: Record<string, number>): number {
  const matches = Math.max(1, state.matches ?? 0);
  const wins = state.wins ?? 0;
  const eliminations = state.eliminations ?? 0;
  const rankTotal = state.finishingRankTotal ?? 0;
  const lowReserveLosses = state.lossOverextension ?? 0;
  const thirdPartyLosses = state.lossThirdParty ?? 0;
  const winRate = wins / matches;
  const eliminationRate = eliminations / matches;
  const averageRankPenalty = rankTotal / matches;
  const strategicLossPenalty = (lowReserveLosses + thirdPartyLosses) / matches;
  return winRate * 100 + eliminationRate * 8 - averageRankPenalty - strategicLossPenalty * 5;
}

const originalTick = VisualAiTrainer.prototype.tick;
VisualAiTrainer.prototype.tick = function adaptiveTick(this: VisualAiTrainer): void {
  const internals = this as unknown as TrainerInternals;
  activeTrainer = internals;

  // Remove arbitrary build delays. The trainer's existing busy flag and the
  // simulation update boundary still prevent duplicate intents in one state.
  internals.nextBuildTick = 0;
  originalTick.call(this);
};

const originalOnGameEnd = VisualAiTrainer.prototype.onGameEnd;
VisualAiTrainer.prototype.onGameEnd = function adaptiveGameEnd(
  this: VisualAiTrainer,
  update: WinUpdate,
): void {
  originalOnGameEnd.call(this, update);
  const internals = this as unknown as TrainerInternals;
  activeTrainer = internals;
  const state = cloneLearning(internals);
  if (state === null) return;

  const score = learningScore(state);
  if (checkpointStore.shouldCheckpoint(score)) {
    checkpointStore.save(state, {
      score,
      matches: state.matches ?? 0,
      label: (state.wins ?? 0) > 0 ? "post-win learning" : "post-match learning",
    });
  }
};

window.openfrontAdaptiveTrainer = {
  listCheckpoints: () => checkpointStore.list(),
  rewindPrevious: () => {
    const state = checkpointStore.rewind();
    return state !== null && applyLearning(state);
  },
  rewindBest: () => {
    const state = checkpointStore.rewindToBest();
    return state !== null && applyLearning(state);
  },
};
