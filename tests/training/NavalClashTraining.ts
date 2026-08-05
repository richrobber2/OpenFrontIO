import {
  fleetCombatPower,
  NAVAL_CLASH_ADVANTAGE,
  selectWarshipDeployment,
  WarshipCombatState,
} from "../../src/client/ai/NavalCombatPolicy";

const BASE_HEALTH = 1_000;
const CLASHES = 2_000;
let seed = 0x51a7cafe;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const ship = (id: number): WarshipCombatState => {
  const veterancy = Math.floor(random() * 4);
  const maximumHealth = BASE_HEALTH * (1 + veterancy * 0.2);
  return {
    id,
    veterancy,
    health: maximumHealth * (0.55 + random() * 0.45),
    distanceSquared: 100 + random() * 40_000,
  };
};

function fight(
  left: WarshipCombatState[],
  right: WarshipCombatState[],
): boolean {
  const fleets = [
    left.map((unit) => ({ ...unit })),
    right.map((unit) => ({ ...unit })),
  ];
  for (
    let volley = 0;
    volley < 40 && fleets.every((fleet) => fleet.length);
    volley++
  ) {
    const damage = fleets.map((attackers) =>
      attackers.map(
        (attacker) =>
          (200 + Math.floor(random() * 101)) * (1 + attacker.veterancy * 0.2),
      ),
    );
    for (let side = 0; side < 2; side++) {
      const defenders = fleets[1 - side];
      for (const shell of damage[side]) {
        if (!defenders.length) break;
        defenders.sort((a, b) => a.health - b.health);
        defenders[0].health -= shell;
        if (defenders[0].health <= 0) defenders.shift();
      }
    }
  }
  return fleets[0].length > 0 && fleets[1].length === 0;
}

let viable = 0;
let wins = 0;
for (let clash = 0; clash < CLASHES; clash++) {
  const enemies = Array.from(
    { length: 1 + Math.floor(random() * 6) },
    (_, id) => ship(1_000 + id),
  );
  const candidates = Array.from(
    { length: 5 + Math.floor(random() * 8) },
    (_, id) => ship(id),
  );
  const enemyPower = fleetCombatPower(enemies, BASE_HEALTH, 20);
  const selected = selectWarshipDeployment(
    candidates,
    enemyPower,
    candidates.length,
    NAVAL_CLASH_ADVANTAGE,
    BASE_HEALTH,
    20,
    20,
  );
  const selectedPower = fleetCombatPower(selected, BASE_HEALTH, 20);
  if (selectedPower < enemyPower * NAVAL_CLASH_ADVANTAGE) continue;
  viable++;
  if (fight(selected, enemies)) wins++;
}

const winRate = wins / Math.max(1, viable);
console.log(
  `Naval clash training: ${wins}/${viable} viable clashes won (${(winRate * 100).toFixed(1)}%) at ${NAVAL_CLASH_ADVANTAGE.toFixed(2)}x strength`,
);
if (viable < CLASHES / 2 || winRate < 0.8) process.exitCode = 1;

let disadvantaged = 0;
let avoided = 0;
let forcedWins = 0;
for (let clash = 0; clash < CLASHES; clash++) {
  const enemies = Array.from(
    { length: 4 + Math.floor(random() * 5) },
    (_, id) => ship(10_000 + id),
  );
  const candidates = Array.from(
    { length: 1 + Math.floor(random() * 4) },
    (_, id) => ship(20_000 + id),
  );
  const enemyPower = fleetCombatPower(enemies, BASE_HEALTH, 20);
  const ownPower = fleetCombatPower(candidates, BASE_HEALTH, 20);
  if (ownPower >= enemyPower * NAVAL_CLASH_ADVANTAGE) continue;
  disadvantaged++;
  const selected = selectWarshipDeployment(
    candidates,
    enemyPower,
    candidates.length,
    NAVAL_CLASH_ADVANTAGE,
    BASE_HEALTH,
    20,
    20,
  );
  if (selected.length === 0) avoided++;
  if (fight(candidates, enemies)) forcedWins++;
}

const avoidanceRate = avoided / Math.max(1, disadvantaged);
const forcedWinRate = forcedWins / Math.max(1, disadvantaged);
console.log(
  `Disadvantage training: avoided ${avoided}/${disadvantaged} losing commitments (${(avoidanceRate * 100).toFixed(1)}%); forced-engagement baseline won ${(forcedWinRate * 100).toFixed(1)}%`,
);
if (
  disadvantaged < CLASHES / 2 ||
  avoidanceRate < 0.99 ||
  forcedWinRate > 0.35
) {
  process.exitCode = 1;
}
