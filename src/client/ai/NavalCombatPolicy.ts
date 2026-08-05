import { maxHealthWithVeterancy } from "../../core/game/Veterancy";

export interface WarshipCombatState {
  id: number;
  health: number;
  veterancy: number;
  distanceSquared: number;
}

export const NAVAL_CLASH_ADVANTAGE = 1.25;

export function warshipHealthRatio(
  health: number,
  baseMaxHealth: number,
  veterancy: number,
  healthBonusPercent: number,
): number {
  return Math.max(
    0,
    Math.min(
      1,
      health /
        maxHealthWithVeterancy(baseMaxHealth, veterancy, healthBonusPercent),
    ),
  );
}

export function warshipCombatPower(
  state: Pick<WarshipCombatState, "health" | "veterancy">,
  baseMaxHealth: number,
  damageBonusPercent: number,
): number {
  const durability = state.health / Math.max(1, baseMaxHealth);
  const damageMultiplier =
    1 + (Math.max(0, state.veterancy) * damageBonusPercent) / 100;
  return Math.max(0, durability * damageMultiplier);
}

export function fleetCombatPower(
  fleet: readonly Pick<WarshipCombatState, "health" | "veterancy">[],
  baseMaxHealth: number,
  damageBonusPercent: number,
): number {
  return fleet.reduce(
    (total, warship) =>
      total + warshipCombatPower(warship, baseMaxHealth, damageBonusPercent),
    0,
  );
}

export function selectWarshipDeployment(
  candidates: readonly WarshipCombatState[],
  targetPower: number,
  maximumShips: number,
  minimumAdvantage: number,
  baseMaxHealth: number,
  healthBonusPercent: number,
  damageBonusPercent: number,
): WarshipCombatState[] {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      healthRatio: warshipHealthRatio(
        candidate.health,
        baseMaxHealth,
        candidate.veterancy,
        healthBonusPercent,
      ),
      power: warshipCombatPower(candidate, baseMaxHealth, damageBonusPercent),
    }))
    .filter(({ healthRatio }) => healthRatio >= 0.35)
    .sort((a, b) => {
      return (
        a.candidate.distanceSquared / Math.max(0.25, a.power) -
          b.candidate.distanceSquared / Math.max(0.25, b.power) ||
        b.power - a.power
      );
    });

  const selected: WarshipCombatState[] = [];
  let power = 0;
  const requiredPower = Math.max(0.5, targetPower * minimumAdvantage);
  for (const { candidate, power: candidatePower } of ranked) {
    if (selected.length >= Math.max(1, maximumShips)) break;
    selected.push(candidate);
    power += candidatePower;
    if (power >= requiredPower) break;
  }
  return power >= requiredPower ? selected : [];
}
