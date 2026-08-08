//! Deterministic forward prediction and adaptive learning math.
//!
//! This module deliberately has no game or browser dependencies. The forward
//! model credits land acquisition for the extra troop capacity and regeneration
//! it unlocks, so successful expansion is valued as compounding growth rather
//! than only as a one-time tile gain.

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredictionAction {
    Hold = 0,
    Attack = 1,
    Expand = 2,
    Defend = 3,
    Fleet = 4,
}

impl PredictionAction {
    pub const fn from_code(code: u32) -> Self {
        match code {
            1 => Self::Attack,
            2 => Self::Expand,
            3 => Self::Defend,
            4 => Self::Fleet,
            _ => Self::Hold,
        }
    }
}

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LossCause {
    Unknown = 0,
    Overextension = 1,
    ThirdParty = 2,
    StalledOffense = 3,
    Containment = 4,
    Infrastructure = 5,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FuturePrediction {
    pub expected_troops: f64,
    pub expected_tiles: f64,
    pub confidence: f64,
    pub expected_max_troops: f64,
    pub capacity_gain: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeedCohortResult {
    pub score_total: f64,
    pub completed_seeds: u32,
    pub complete: bool,
    pub average_score: f64,
    pub accepted: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActionRewardBaseline {
    pub mean: f64,
    pub samples: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NormalizedActionReward {
    pub learning_signal: f64,
    pub baseline: ActionRewardBaseline,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActionOutcome {
    pub action: PredictionAction,
    pub starting_troops: f64,
    pub ending_troops: f64,
    pub max_troops: f64,
    pub starting_tiles: f64,
    pub ending_tiles: f64,
    pub starting_gold: f64,
    pub ending_gold: f64,
    pub survived: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActionOutcomeGenes {
    pub aggression: f64,
    pub caution: f64,
    pub naval: f64,
}

#[inline]
fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

#[inline]
pub fn land_troop_capacity(tiles: f64) -> f64 {
    2.0 * (tiles.max(0.0).powf(0.6) * 1_000.0 + 50_000.0)
}

#[inline]
pub fn human_troop_regeneration(troops: f64, max_troops: f64) -> f64 {
    let safe_max = max_troops.max(1.0);
    let safe_troops = troops.max(0.0);
    let base = 10.0 + safe_troops.powf(0.73) / 4.0;
    (safe_troops + base * (1.0 - safe_troops / safe_max))
        .min(safe_max)
        .sub(safe_troops)
        .max(0.0)
}

trait F64Sub {
    fn sub(self, rhs: Self) -> Self;
}

impl F64Sub for f64 {
    #[inline]
    fn sub(self, rhs: Self) -> Self {
        self - rhs
    }
}

fn simulate_regeneration(
    starting_troops: f64,
    current_max_troops: f64,
    projected_max_troops: f64,
    horizon: f64,
    active_fraction: f64,
) -> f64 {
    let active_ticks = horizon.max(0.0) * clamp(active_fraction, 0.0, 1.0);
    if active_ticks <= 0.0 {
        return clamp(starting_troops, 0.0, projected_max_troops.max(1.0));
    }

    let steps = ((active_ticks / 30.0).ceil() as u32).clamp(1, 12);
    let step_ticks = active_ticks / steps as f64;
    let mut troops = starting_troops.max(0.0);
    for step in 0..steps {
        let progress = (step + 1) as f64 / steps as f64;
        let step_max = current_max_troops
            + (projected_max_troops - current_max_troops) * progress;
        let rate = human_troop_regeneration(troops, step_max);
        troops = (troops + rate * step_ticks).min(step_max.max(1.0));
    }
    troops
}

/// Growth-aware deterministic forward model used for portable action traces.
pub fn predict_future_outcome(
    action: PredictionAction,
    troops: f64,
    max_troops: f64,
    tiles: f64,
    enemy_troops: f64,
    horizon: f64,
    sample: f64,
) -> FuturePrediction {
    let safe_max = max_troops.max(1.0);
    let safe_tiles = tiles.max(0.0);
    let safe_horizon = horizon.max(1.0);
    let uncertainty = clamp(1.0 + (sample - 2.0) * 0.04, 0.84, 1.16);
    let horizon_scale = clamp(safe_horizon / 120.0, 0.25, 2.5);

    let attack_power = troops.max(0.0).mul_add(0.4, 0.0).min(enemy_troops.max(0.0) * 0.9)
        * uncertainty;
    let attack_time_scale = clamp(horizon_scale.sqrt(), 0.7, 1.5);
    let expected_tiles = match action {
        PredictionAction::Attack => {
            let gain = (attack_power / enemy_troops.max(1.0)).max(0.0)
                * safe_tiles
                * 0.08
                * attack_time_scale;
            safe_tiles + gain.min(safe_tiles * 0.14)
        }
        PredictionAction::Expand => {
            let growth_fraction = (0.04 * horizon_scale).min(0.12);
            safe_tiles + (safe_tiles * growth_fraction * uncertainty).max(1.0)
        }
        _ => safe_tiles,
    };

    let current_land_capacity = land_troop_capacity(safe_tiles);
    let projected_land_capacity = land_troop_capacity(expected_tiles.max(safe_tiles));
    let capacity_gain = (projected_land_capacity - current_land_capacity).max(0.0);
    let expected_max_troops = safe_max + capacity_gain;

    let action_cost = match action {
        PredictionAction::Attack => attack_power,
        PredictionAction::Expand => troops.max(0.0) * 0.16,
        PredictionAction::Fleet => troops.max(0.0) * 0.12,
        _ => 0.0,
    };
    let post_action_troops = (troops.max(0.0) - action_cost).max(0.0);
    let regeneration_fraction = match action {
        PredictionAction::Hold | PredictionAction::Defend => 1.0,
        PredictionAction::Expand => 0.75,
        PredictionAction::Fleet => 0.55,
        PredictionAction::Attack => 0.45,
    };
    let expected_troops = simulate_regeneration(
        post_action_troops,
        safe_max,
        expected_max_troops,
        safe_horizon,
        regeneration_fraction,
    );

    let sample_confidence = (1.0 - (sample - 2.0).abs() * 0.12).max(0.1);
    let horizon_confidence = 1.0 / (1.0 + (safe_horizon - 120.0).max(0.0) / 1_200.0);

    FuturePrediction {
        expected_troops,
        expected_tiles,
        confidence: (sample_confidence * horizon_confidence).max(0.1),
        expected_max_troops,
        capacity_gain,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn score_mutation_outcome(
    won: bool,
    alive: bool,
    player_count: f64,
    finishing_rank: f64,
    raid_success_rate: f64,
    retaliation_rate: f64,
    transport_loss_rate: f64,
    prediction_quality: f64,
    starting_tiles: f64,
    peak_tiles: f64,
    total_land_tiles: f64,
    elapsed_ticks: f64,
    no_growth_ticks: f64,
    longest_no_growth_ticks: f64,
    peak_cities: f64,
    peak_factories: f64,
) -> f64 {
    let growth_multiple = peak_tiles.max(1.0) / starting_tiles.max(1.0);
    let territory_share = peak_tiles.max(0.0) / total_land_tiles.max(1.0);
    let stagnation_ratio = no_growth_ticks.max(longest_no_growth_ticks) / elapsed_ticks.max(1.0);
    let relative_growth = (peak_tiles - starting_tiles).max(0.0) / starting_tiles.max(1.0);
    let thousand_tick_windows = (elapsed_ticks / 1_000.0).max(0.25);
    let growth_pace = relative_growth / thousand_tick_windows;
    let growth_score = (growth_multiple.max(1.0).log2() * 60.0).min(450.0)
        + (territory_share * 7_200.0).min(720.0)
        + (growth_pace * 90.0).min(180.0);
    let economy_score = (peak_cities.max(0.0) * 8.0 + peak_factories.max(0.0) * 32.0).min(160.0);

    (if won { 1_200.0 } else { 0.0 })
        + (player_count.max(1.0) - finishing_rank.max(1.0)) * 2.0
        - if !alive { 150.0 } else { 0.0 }
        + growth_score
        + economy_score
        - (stagnation_ratio.max(0.0) * 420.0).min(420.0)
        + clamp(raid_success_rate, 0.0, 1.0) * 60.0
        - clamp(retaliation_rate, 0.0, 1.0) * 100.0
        - clamp(transport_loss_rate, 0.0, 1.0) * 100.0
        + clamp(prediction_quality, -1.0, 1.0) * 80.0
}

#[allow(clippy::too_many_arguments)]
pub fn classify_loss_cause(
    elapsed_ticks: f64,
    third_party_pressure_ticks: f64,
    max_incoming_ratio: f64,
    low_reserve_ticks: f64,
    max_committed_ratio: f64,
    longest_stall_ticks: f64,
    longest_no_growth_ticks: f64,
    no_gain_ticks: f64,
    peak_tiles: f64,
    peak_cities: f64,
) -> LossCause {
    if longest_no_growth_ticks >= (elapsed_ticks * 0.18).max(300.0)
        || no_gain_ticks >= (elapsed_ticks * 0.22).max(400.0)
    {
        return LossCause::Containment;
    }
    if third_party_pressure_ticks >= (elapsed_ticks * 0.18).min(60.0)
        && max_incoming_ratio >= 0.3
    {
        return LossCause::ThirdParty;
    }
    if low_reserve_ticks >= elapsed_ticks * 0.18 && max_committed_ratio >= 0.5 {
        return LossCause::Overextension;
    }
    if longest_stall_ticks >= 180.0 {
        return LossCause::StalledOffense;
    }
    if no_gain_ticks >= 250.0 && peak_tiles < 3_000.0 {
        return LossCause::Containment;
    }
    if peak_cities == 0.0 && (max_incoming_ratio >= 0.6 || peak_tiles < 2_000.0) {
        return LossCause::Infrastructure;
    }
    LossCause::Unknown
}

pub fn evaluate_seed_cohort(
    score_total: f64,
    completed_seeds: u32,
    next_score: f64,
    required_seeds: u32,
    baseline_score: f64,
    first_generation: bool,
) -> SeedCohortResult {
    let total = score_total + next_score;
    let completed = completed_seeds.saturating_add(1);
    let complete = completed >= required_seeds.max(1);
    let average_score = total / completed.max(1) as f64;
    SeedCohortResult {
        score_total: total,
        completed_seeds: completed,
        complete,
        average_score,
        accepted: if complete {
            Some(first_generation || average_score >= baseline_score)
        } else {
            None
        },
    }
}

pub fn score_delayed_action_outcome(outcome: ActionOutcome) -> f64 {
    if !outcome.survived {
        return -1.0;
    }
    let reserve_delta =
        (outcome.ending_troops - outcome.starting_troops) / outcome.max_troops.max(1.0);
    let land_delta =
        (outcome.ending_tiles - outcome.starting_tiles) / outcome.starting_tiles.max(25.0);
    let gold_delta =
        (outcome.ending_gold - outcome.starting_gold) / outcome.starting_gold.abs().max(25_000.0);
    let action_land_weight = if matches!(outcome.action, PredictionAction::Attack | PredictionAction::Expand) {
        0.65
    } else {
        0.25
    };
    let action_reserve_weight = if matches!(outcome.action, PredictionAction::Defend | PredictionAction::Hold) {
        0.65
    } else {
        0.3
    };
    clamp(
        land_delta * action_land_weight + reserve_delta * action_reserve_weight + gold_delta * 0.15,
        -1.0,
        1.0,
    )
}

pub fn score_counterfactual_action_outcome(
    outcome: ActionOutcome,
    expected_troops: f64,
    expected_tiles: f64,
) -> f64 {
    if !outcome.survived {
        return -1.0;
    }
    let troop_advantage = (outcome.ending_troops - expected_troops) / outcome.max_troops.max(1.0);
    let tile_advantage =
        (outcome.ending_tiles - expected_tiles) / outcome.starting_tiles.max(25.0);
    let land_weight = if matches!(outcome.action, PredictionAction::Attack | PredictionAction::Expand) {
        0.7
    } else {
        0.3
    };
    let troop_weight = 1.0 - land_weight;
    clamp(
        tile_advantage * land_weight + troop_advantage * troop_weight,
        -1.0,
        1.0,
    )
}

pub fn normalize_action_reward(
    reward: f64,
    baseline: ActionRewardBaseline,
) -> NormalizedActionReward {
    let bounded_reward = clamp(reward, -1.0, 1.0);
    let learning_signal = if baseline.samples == 0 {
        bounded_reward
    } else {
        bounded_reward - baseline.mean
    };
    let samples = baseline.samples.saturating_add(1).min(10_000);
    let window = samples.min(64).max(1) as f64;
    NormalizedActionReward {
        learning_signal: if learning_signal.abs() < 0.01 {
            0.0
        } else {
            learning_signal
        },
        baseline: ActionRewardBaseline {
            mean: baseline.mean + (bounded_reward - baseline.mean) / window,
            samples,
        },
    }
}

#[inline]
fn clamp_gene(value: f64) -> f64 {
    clamp(value, -1.0, 1.0)
}

pub fn apply_action_outcome_learning(
    genes: ActionOutcomeGenes,
    action: PredictionAction,
    reward: f64,
    prior_samples: f64,
    attribution_weight: f64,
) -> ActionOutcomeGenes {
    let bounded_attribution = clamp(attribution_weight, 0.1, 1.0);
    let regularization = 0.002 * bounded_attribution;
    let step = (0.08 / (prior_samples.max(0.0) + 1.0).sqrt()) * reward * bounded_attribution;
    let mut next = genes;
    match action {
        PredictionAction::Attack | PredictionAction::Expand => {
            next.aggression = clamp_gene(next.aggression + step - next.aggression * regularization);
        }
        PredictionAction::Fleet => {
            next.naval = clamp_gene(next.naval + step - next.naval * regularization);
        }
        PredictionAction::Hold | PredictionAction::Defend => {
            next.caution = clamp_gene(next.caution + step - next.caution * regularization);
        }
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longer_expansion_compounds_land_capacity() {
        let short = predict_future_outcome(
            PredictionAction::Expand,
            800_000.0,
            1_000_000.0,
            5_000.0,
            700_000.0,
            60.0,
            2.0,
        );
        let long = predict_future_outcome(
            PredictionAction::Expand,
            800_000.0,
            1_000_000.0,
            5_000.0,
            700_000.0,
            300.0,
            2.0,
        );
        assert!(long.expected_tiles > short.expected_tiles);
        assert!(long.capacity_gain > short.capacity_gain);
        assert!(long.expected_max_troops > short.expected_max_troops);
    }

    #[test]
    fn growth_pace_improves_mutation_score() {
        let fast = score_mutation_outcome(
            false, true, 10.0, 3.0, 0.5, 0.1, 0.1, 0.0, 1_000.0, 6_000.0, 50_000.0,
            2_000.0, 20.0, 40.0, 4.0, 2.0,
        );
        let slow = score_mutation_outcome(
            false, true, 10.0, 3.0, 0.5, 0.1, 0.1, 0.0, 1_000.0, 6_000.0, 50_000.0,
            8_000.0, 20.0, 40.0, 4.0, 2.0,
        );
        assert!(fast > slow);
    }

    #[test]
    fn containment_is_identified_before_other_loss_causes() {
        assert_eq!(
            classify_loss_cause(2_000.0, 100.0, 0.8, 500.0, 0.8, 300.0, 500.0, 500.0, 2_500.0, 0.0),
            LossCause::Containment
        );
    }

    #[test]
    fn seed_cohort_waits_for_full_evidence() {
        let pending = evaluate_seed_cohort(10.0, 1, 12.0, 4, 9.0, false);
        assert!(!pending.complete);
        assert_eq!(pending.accepted, None);
        let complete = evaluate_seed_cohort(30.0, 3, 12.0, 4, 9.0, false);
        assert!(complete.complete);
        assert_eq!(complete.accepted, Some(true));
    }
}
