//! Deterministic strategic AI scoring shared by the browser and future server AI.
//!
//! This module intentionally contains no game-view, event-bus, rendering, or
//! WebAssembly code. JavaScript gathers observations; Rust owns the policy math.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoalitionHelper {
    pub reliability: f64,
    pub reserve_ratio: f64,
    pub can_reach: bool,
    pub treaty_blocked: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CoalitionTargetEvaluation {
    pub score: f64,
    pub offensive_cost_multiplier: f64,
    /// 0 = unavailable, 1 = available, 2 = treaty blocked.
    pub helper_states: Vec<u32>,
    pub available_helpers: usize,
    pub treaty_blocked_helpers: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PredictedChoice {
    Other = 0,
    Expand = 1,
    Economy = 2,
    Attack = 3,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OpponentModel {
    pub troop_ratio: f64,
    pub territory_ratio: f64,
    pub territory_growth_rate: f64,
    pub troop_growth_rate: f64,
    pub growth_pressure: f64,
    pub military_pressure: f64,
    pub silo_count: f64,
    pub naval_pressure: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum StrategicAction {
    Defend = 0,
    Strike = 1,
    Naval = 2,
    Expand = 3,
    Attack = 4,
    Infrastructure = 5,
}

impl StrategicAction {
    pub const COUNT: usize = 6;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StrategicPlanInput {
    pub reserve_ratio: f64,
    pub incoming_fronts: u32,
    pub incoming_troops: f64,
    pub max_troops: f64,
    pub has_neutral_land: bool,
    pub hostile_borders: u32,
    pub active_nation_wars: u32,
    pub naval_threats: u32,
    pub trade_targets: u32,
    pub naval_pressure_ratio: Option<f64>,
    pub trade_opportunity_ratio: f64,
    pub ready_strategic_slots: u32,
    pub affordable_strategic_weapons: u32,
    pub actionable_strike_targets: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StrategicPlan {
    pub action: StrategicAction,
    pub score: f64,
    pub scores: [f64; StrategicAction::COUNT],
    pub strongest_opponent_index: Option<usize>,
    pub critical_defense: bool,
    pub incoming_troop_ratio: f64,
}

#[inline]
fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

/// Evaluate one reachable coalition target. The caller retains target identity;
/// Rust owns helper eligibility and the offensive-cost discount.
pub fn evaluate_coalition_target(
    base_priority: f64,
    enemy_active_wars: u32,
    helpers: &[CoalitionHelper],
) -> CoalitionTargetEvaluation {
    let mut helper_value = 0.0;
    let mut available_helpers = 0usize;
    let mut treaty_blocked_helpers = 0usize;
    let mut helper_states = Vec::with_capacity(helpers.len());

    for helper in helpers {
        if helper.can_reach && helper.treaty_blocked {
            treaty_blocked_helpers += 1;
            helper_states.push(2);
            continue;
        }

        if helper.can_reach
            && !helper.treaty_blocked
            && helper.reliability >= 0.45
            && helper.reserve_ratio >= 0.5
        {
            available_helpers += 1;
            helper_value += helper.reliability * 1.5
                + clamp((helper.reserve_ratio - 0.5) / 0.5, 0.0, 1.0) * 0.75;
            helper_states.push(1);
        } else {
            helper_states.push(0);
        }
    }

    let score = base_priority + helper_value + enemy_active_wars.min(3) as f64 * 0.3
        - treaty_blocked_helpers as f64 * 0.15;
    let offensive_cost_multiplier = clamp(1.0 - (helper_value * 0.18).min(0.32), 0.68, 1.0);

    CoalitionTargetEvaluation {
        score,
        offensive_cost_multiplier,
        helper_states,
        available_helpers,
        treaty_blocked_helpers,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn model_opponent(
    troops: f64,
    max_troops: f64,
    tiles: f64,
    own_tiles: f64,
    incoming_attacks: u32,
    outgoing_attacks: u32,
    silos: u32,
    warships: u32,
    previous_tiles: f64,
    previous_troops: f64,
    elapsed_ticks: f64,
    predicted_choice: PredictedChoice,
    forecast_threat: f64,
) -> OpponentModel {
    let troop_ratio = troops / max_troops.max(1.0);
    let territory_ratio = tiles / own_tiles.max(1.0);
    let ticks = elapsed_ticks.max(1.0);
    let territory_growth_rate = (tiles - previous_tiles).max(0.0) / ticks;
    let troop_growth_rate = (troops - previous_troops).max(0.0) / ticks;

    let forecast_growth_bonus = if matches!(
        predicted_choice,
        PredictedChoice::Expand | PredictedChoice::Economy
    ) {
        (forecast_threat * 0.25 + 0.15).min(0.65)
    } else {
        0.0
    };
    let attack_forecast_bonus = if predicted_choice == PredictedChoice::Attack {
        0.3
    } else {
        0.0
    };

    OpponentModel {
        troop_ratio,
        territory_ratio,
        territory_growth_rate,
        troop_growth_rate,
        growth_pressure: (territory_ratio * 0.7
            + territory_growth_rate * 0.08
            + (troop_growth_rate / max_troops.max(1.0)) * 20.0
            + outgoing_attacks as f64 * 0.12
            + forecast_growth_bonus)
            .min(2.0),
        military_pressure: (troop_ratio * 0.8
            + incoming_attacks as f64 * 0.15
            + outgoing_attacks as f64 * 0.2
            + attack_forecast_bonus
            + (forecast_threat * 0.2).min(0.7))
        .min(2.0),
        silo_count: silos as f64,
        naval_pressure: (warships as f64 * 0.15).min(2.0),
    }
}

pub fn plan_strategic_action(
    input: StrategicPlanInput,
    opponents: &[OpponentModel],
) -> StrategicPlan {
    let incoming_troop_ratio = input.incoming_troops / input.max_troops.max(1.0);
    let strongest_opponent_index = opponents
        .iter()
        .enumerate()
        .fold(None, |best: Option<(usize, f64)>, (index, opponent)| {
            let pressure = opponent.military_pressure + opponent.growth_pressure;
            match best {
                Some((_, best_pressure)) if pressure <= best_pressure => best,
                _ => Some((index, pressure)),
            }
        })
        .map(|(index, _)| index);
    let strongest = strongest_opponent_index.and_then(|index| opponents.get(index));

    let defend = input.incoming_fronts as f64 * 40.0
        + incoming_troop_ratio * 70.0
        + if input.reserve_ratio < 0.4 { 35.0 } else { 0.0 };
    let strike = if input.ready_strategic_slots > 0
        && input.affordable_strategic_weapons > 0
        && input.actionable_strike_targets > 0
    {
        input.actionable_strike_targets.min(3) as f64 * 24.0
            + strongest.map_or(0.0, |opponent| opponent.growth_pressure) * 18.0
            + strongest.map_or(0.0, |opponent| opponent.silo_count.min(3.0)) * 18.0
    } else {
        0.0
    };
    let naval = match input.naval_pressure_ratio {
        None => input.naval_threats as f64 * 28.0 + input.trade_targets as f64 * 8.0,
        Some(pressure) => {
            clamp(pressure, 0.0, 1.0) * 52.0 + clamp(input.trade_opportunity_ratio, 0.0, 1.0) * 20.0
        }
    };
    let expand = if input.has_neutral_land {
        24.0 + if input.reserve_ratio > 0.5 { 22.0 } else { 0.0 }
    } else {
        0.0
    };
    let attack = input.hostile_borders as f64 * 12.0
        + if input.reserve_ratio > 0.55 {
            20.0
        } else {
            0.0
        }
        - input.active_nation_wars as f64 * 18.0;
    let infrastructure = if input.reserve_ratio > 0.6 { 18.0 } else { 4.0 }
        + if input.hostile_borders > 0 { 12.0 } else { 0.0 };

    let scores = [defend, strike, naval, expand, attack, infrastructure];
    let critical_defense =
        input.incoming_fronts > 0 && (input.reserve_ratio < 0.4 || incoming_troop_ratio >= 0.35);

    let action = if critical_defense {
        StrategicAction::Defend
    } else {
        let mut best_index = 0usize;
        for index in 1..scores.len() {
            if scores[index] > scores[best_index] {
                best_index = index;
            }
        }
        match best_index {
            0 => StrategicAction::Defend,
            1 => StrategicAction::Strike,
            2 => StrategicAction::Naval,
            3 => StrategicAction::Expand,
            4 => StrategicAction::Attack,
            _ => StrategicAction::Infrastructure,
        }
    };

    StrategicPlan {
        score: scores[action as usize],
        action,
        scores,
        strongest_opponent_index,
        critical_defense,
        incoming_troop_ratio,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalition_helpers_lower_offensive_cost_and_raise_score() {
        let evaluation = evaluate_coalition_target(
            5.0,
            2,
            &[
                CoalitionHelper {
                    reliability: 0.9,
                    reserve_ratio: 0.8,
                    can_reach: true,
                    treaty_blocked: false,
                },
                CoalitionHelper {
                    reliability: 1.0,
                    reserve_ratio: 1.0,
                    can_reach: true,
                    treaty_blocked: true,
                },
            ],
        );

        assert_eq!(evaluation.available_helpers, 1);
        assert_eq!(evaluation.treaty_blocked_helpers, 1);
        assert_eq!(evaluation.helper_states, vec![1, 2]);
        assert!(evaluation.score > 5.0);
        assert!(evaluation.offensive_cost_multiplier < 1.0);
    }

    #[test]
    fn opponent_forecast_changes_pressure_in_rust() {
        let baseline = model_opponent(
            70.0,
            100.0,
            100.0,
            100.0,
            0,
            1,
            0,
            0,
            90.0,
            65.0,
            10.0,
            PredictedChoice::Other,
            0.0,
        );
        let attacking = model_opponent(
            70.0,
            100.0,
            100.0,
            100.0,
            0,
            1,
            0,
            0,
            90.0,
            65.0,
            10.0,
            PredictedChoice::Attack,
            1.0,
        );

        assert!(attacking.military_pressure > baseline.military_pressure);
    }

    #[test]
    fn critical_defense_overrides_higher_optional_scores() {
        let opponent = model_opponent(
            100.0,
            100.0,
            300.0,
            100.0,
            2,
            2,
            4,
            8,
            250.0,
            80.0,
            10.0,
            PredictedChoice::Attack,
            1.0,
        );
        let plan = plan_strategic_action(
            StrategicPlanInput {
                reserve_ratio: 0.3,
                incoming_fronts: 1,
                incoming_troops: 40.0,
                max_troops: 100.0,
                has_neutral_land: true,
                hostile_borders: 3,
                active_nation_wars: 0,
                naval_threats: 5,
                trade_targets: 5,
                naval_pressure_ratio: None,
                trade_opportunity_ratio: 0.0,
                ready_strategic_slots: 3,
                affordable_strategic_weapons: 3,
                actionable_strike_targets: 3,
            },
            &[opponent],
        );

        assert_eq!(plan.action, StrategicAction::Defend);
        assert!(plan.critical_defense);
    }

    #[test]
    fn strategic_plan_keeps_first_action_on_score_ties() {
        let plan = plan_strategic_action(
            StrategicPlanInput {
                reserve_ratio: 0.0,
                incoming_fronts: 0,
                incoming_troops: 0.0,
                max_troops: 100.0,
                has_neutral_land: false,
                hostile_borders: 0,
                active_nation_wars: 0,
                naval_threats: 0,
                trade_targets: 0,
                naval_pressure_ratio: Some(0.0),
                trade_opportunity_ratio: 0.0,
                ready_strategic_slots: 0,
                affordable_strategic_weapons: 0,
                actionable_strike_targets: 0,
            },
            &[],
        );

        assert_eq!(plan.action, StrategicAction::Infrastructure);
        assert_eq!(plan.score, 4.0);
    }
}
