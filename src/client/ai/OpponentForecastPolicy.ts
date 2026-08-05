export type OpponentChoice =
  | "attack"
  | "defend"
  | "expand"
  | "bank"
  | "economy"
  | "naval";

export type OpponentObservation = {
  tick: number;
  troops: number;
  maxTroops: number;
  tiles: number;
  gold: number;
  incomingAttacks: number;
  incomingTroops: number;
  outgoingAttacks: number;
  outgoingTroops: number;
  cities: number;
  factories: number;
  ports: number;
  silos: number;
  warships: number;
  allied: boolean;
  sharesBorder: boolean;
};

export type OpponentProjection = {
  tick: number;
  troops: number;
  tiles: number;
  reserveRatio: number;
};

export type OpponentForecast = {
  id: string;
  observedChoice: OpponentChoice;
  predictedChoice: OpponentChoice;
  probabilities: Record<OpponentChoice, number>;
  confidence: number;
  threat: number;
  projected: {
    near: OpponentProjection;
    far: OpponentProjection;
  };
};

const choices: readonly OpponentChoice[] = [
  "attack",
  "defend",
  "expand",
  "bank",
  "economy",
  "naval",
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function delta(
  current: OpponentObservation,
  previous: OpponentObservation | undefined,
  key: keyof OpponentObservation,
): number {
  const currentValue = current[key];
  const previousValue = previous?.[key];
  return typeof currentValue === "number" && typeof previousValue === "number"
    ? currentValue - previousValue
    : 0;
}

export function inferOpponentChoice(
  current: OpponentObservation,
  previous?: OpponentObservation,
): OpponentChoice {
  const tileDelta = delta(current, previous, "tiles");
  const outgoingDelta = delta(current, previous, "outgoingTroops");
  const structureDelta =
    delta(current, previous, "cities") +
    delta(current, previous, "factories") +
    delta(current, previous, "ports") +
    delta(current, previous, "silos");
  const navalDelta =
    delta(current, previous, "warships") + delta(current, previous, "ports");

  if (
    current.incomingAttacks > 0 &&
    (tileDelta < 0 || current.incomingTroops > current.outgoingTroops)
  ) {
    return "defend";
  }
  if (
    outgoingDelta > 0 ||
    (current.outgoingAttacks > 0 && current.outgoingTroops > 0)
  ) {
    return "attack";
  }
  if (navalDelta > 0) return "naval";
  if (structureDelta > 0) return "economy";
  if (tileDelta > 0) return "expand";
  return "bank";
}

export function forecastOpponent({
  id,
  current,
  previous,
  previousForecast,
  ownTroops,
  ownMaxTroops,
  ownTiles,
}: {
  id: string;
  current: OpponentObservation;
  previous?: OpponentObservation;
  previousForecast?: OpponentForecast;
  ownTroops: number;
  ownMaxTroops: number;
  ownTiles: number;
}): OpponentForecast {
  const elapsedTicks = Math.max(
    1,
    current.tick - (previous?.tick ?? current.tick),
  );
  const troopDelta = delta(current, previous, "troops") / elapsedTicks;
  const tileDelta = delta(current, previous, "tiles") / elapsedTicks;
  const goldDelta = delta(current, previous, "gold") / elapsedTicks;
  const outgoingDelta =
    delta(current, previous, "outgoingTroops") / Math.max(1, current.maxTroops);
  const structureDelta =
    delta(current, previous, "cities") +
    delta(current, previous, "factories") +
    delta(current, previous, "ports") +
    delta(current, previous, "silos");
  const navalDelta =
    delta(current, previous, "warships") + delta(current, previous, "ports");
  const reserveRatio = current.troops / Math.max(1, current.maxTroops);
  const observedChoice = inferOpponentChoice(current, previous);
  const scores: Record<OpponentChoice, number> = {
    attack:
      0.2 +
      current.outgoingAttacks * 1.25 +
      (current.outgoingTroops / Math.max(1, current.maxTroops)) * 2.4 +
      Math.max(0, outgoingDelta) * 4 +
      (reserveRatio > 0.62 ? 0.45 : 0),
    defend:
      0.15 +
      current.incomingAttacks * 1.45 +
      (current.incomingTroops / Math.max(1, current.maxTroops)) * 2.8 +
      (tileDelta < 0 ? Math.min(2, -tileDelta * 0.08) : 0),
    expand:
      0.2 +
      Math.min(3, Math.max(0, tileDelta) * 0.12) +
      (current.tiles < ownTiles * 0.45 ? 0.5 : 0) +
      (current.outgoingAttacks === 0 && reserveRatio > 0.45 ? 0.25 : 0),
    bank:
      0.25 +
      (current.incomingAttacks + current.outgoingAttacks === 0 ? 0.65 : 0) +
      (troopDelta > 0
        ? Math.min(1.5, (troopDelta / Math.max(1, current.maxTroops)) * 400)
        : 0) +
      (reserveRatio < 0.45 ? 0.55 : 0),
    economy:
      0.15 +
      Math.max(0, structureDelta) * 1.4 +
      (goldDelta < 0 ? 0.35 : 0) +
      (reserveRatio > 0.5 && current.incomingAttacks === 0 ? 0.35 : 0),
    naval:
      0.1 +
      Math.max(0, navalDelta) * 1.5 +
      current.warships * 0.08 +
      (current.ports > 0 ? 0.2 : 0),
  };

  scores[observedChoice] += 1.1;
  if (previousForecast !== undefined) {
    scores[previousForecast.predictedChoice] +=
      0.35 + previousForecast.confidence * 0.45;
  }

  const totalScore = choices.reduce(
    (sum, choice) => sum + Math.max(0.001, scores[choice]),
    0,
  );
  const probabilities = Object.fromEntries(
    choices.map((choice) => [
      choice,
      Math.max(0.001, scores[choice]) / totalScore,
    ]),
  ) as Record<OpponentChoice, number>;
  const rankedChoices = choices
    .slice()
    .sort((a, b) => probabilities[b] - probabilities[a]);
  const predictedChoice = rankedChoices[0];
  const confidence = clamp(
    probabilities[predictedChoice] - probabilities[rankedChoices[1]],
    0,
    1,
  );

  const project = (horizon: number): OpponentProjection => {
    const actionTroopFactor =
      predictedChoice === "attack"
        ? -0.0008
        : predictedChoice === "defend"
          ? -0.00025
          : predictedChoice === "bank"
            ? 0.0007
            : 0.00025;
    const actionTileRate =
      predictedChoice === "expand" || predictedChoice === "attack"
        ? Math.max(0.02, tileDelta)
        : Math.max(0, tileDelta * 0.35);
    const projectedTroops = clamp(
      current.troops +
        (troopDelta + current.maxTroops * actionTroopFactor) * horizon,
      0,
      current.maxTroops,
    );
    const projectedTiles = Math.max(
      0,
      Math.round(current.tiles + actionTileRate * horizon),
    );
    return {
      tick: current.tick + horizon,
      troops: projectedTroops,
      tiles: projectedTiles,
      reserveRatio: projectedTroops / Math.max(1, current.maxTroops),
    };
  };

  const forcePressure =
    (current.troops + current.outgoingTroops) / Math.max(1, ownTroops);
  const capacityPressure = current.maxTroops / Math.max(1, ownMaxTroops);
  const territoryPressure = current.tiles / Math.max(1, ownTiles);
  const strategicPressure =
    current.silos * 0.12 + current.warships * 0.025 + current.factories * 0.02;
  const relationshipFactor = current.allied ? 0.55 : 1;
  const proximityFactor = current.sharesBorder ? 1.25 : 0.8;
  const choiceFactor =
    predictedChoice === "attack"
      ? 1.25
      : predictedChoice === "economy" || predictedChoice === "expand"
        ? 1.1
        : 1;

  return {
    id,
    observedChoice,
    predictedChoice,
    probabilities,
    confidence,
    threat:
      (forcePressure * 0.4 +
        capacityPressure * 0.25 +
        territoryPressure * 0.2 +
        strategicPressure) *
      relationshipFactor *
      proximityFactor *
      choiceFactor,
    projected: {
      near: project(120),
      far: project(600),
    },
  };
}
