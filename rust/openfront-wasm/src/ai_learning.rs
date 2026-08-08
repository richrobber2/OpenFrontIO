use openfront_core::{
    apply_action_outcome_learning, classify_loss_cause, evaluate_seed_cohort,
    normalize_action_reward, predict_future_outcome, score_counterfactual_action_outcome,
    score_delayed_action_outcome, score_mutation_outcome, ActionOutcome, ActionOutcomeGenes,
    ActionRewardBaseline, PredictionAction,
};

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_predict_future_outcome(
    action: u32,
    troops: f64,
    max_troops: f64,
    tiles: f64,
    enemy_troops: f64,
    horizon: f64,
    sample: f64,
) -> u32 {
    begin_call();
    let prediction = predict_future_outcome(
        PredictionAction::from_code(action),
        troops,
        max_troops,
        tiles,
        enemy_troops,
        horizon,
        sample,
    );
    set_f64_result([
        prediction.expected_troops,
        prediction.expected_tiles,
        prediction.confidence,
        prediction.expected_max_troops,
        prediction.capacity_gain,
    ]);
    1
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_score_mutation_outcome(
    won: u32,
    alive: u32,
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
    begin_call();
    score_mutation_outcome(
        won != 0,
        alive != 0,
        player_count,
        finishing_rank,
        raid_success_rate,
        retaliation_rate,
        transport_loss_rate,
        prediction_quality,
        starting_tiles,
        peak_tiles,
        total_land_tiles,
        elapsed_ticks,
        no_growth_ticks,
        longest_no_growth_ticks,
        peak_cities,
        peak_factories,
    )
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_classify_loss_cause(
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
) -> u32 {
    begin_call();
    classify_loss_cause(
        elapsed_ticks,
        third_party_pressure_ticks,
        max_incoming_ratio,
        low_reserve_ticks,
        max_committed_ratio,
        longest_stall_ticks,
        longest_no_growth_ticks,
        no_gain_ticks,
        peak_tiles,
        peak_cities,
    ) as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_evaluate_seed_cohort(
    score_total: f64,
    completed_seeds: u32,
    next_score: f64,
    required_seeds: u32,
    baseline_score: f64,
    first_generation: u32,
) -> u32 {
    begin_call();
    let result = evaluate_seed_cohort(
        score_total,
        completed_seeds,
        next_score,
        required_seeds,
        baseline_score,
        first_generation != 0,
    );
    let accepted = match result.accepted {
        None => 0,
        Some(false) => 1,
        Some(true) => 2,
    };
    set_result([
        result.completed_seeds,
        if result.complete { 1 } else { 0 },
        accepted,
    ]);
    set_f64_result([result.score_total, result.average_score]);
    1
}

#[inline]
fn action_outcome(
    action: u32,
    starting_troops: f64,
    ending_troops: f64,
    max_troops: f64,
    starting_tiles: f64,
    ending_tiles: f64,
    starting_gold: f64,
    ending_gold: f64,
    survived: u32,
) -> ActionOutcome {
    ActionOutcome {
        action: PredictionAction::from_code(action),
        starting_troops,
        ending_troops,
        max_troops,
        starting_tiles,
        ending_tiles,
        starting_gold,
        ending_gold,
        survived: survived != 0,
    }
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_score_delayed_action_outcome(
    action: u32,
    starting_troops: f64,
    ending_troops: f64,
    max_troops: f64,
    starting_tiles: f64,
    ending_tiles: f64,
    starting_gold: f64,
    ending_gold: f64,
    survived: u32,
) -> f64 {
    begin_call();
    score_delayed_action_outcome(action_outcome(
        action,
        starting_troops,
        ending_troops,
        max_troops,
        starting_tiles,
        ending_tiles,
        starting_gold,
        ending_gold,
        survived,
    ))
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_score_counterfactual_action_outcome(
    action: u32,
    starting_troops: f64,
    ending_troops: f64,
    max_troops: f64,
    starting_tiles: f64,
    ending_tiles: f64,
    starting_gold: f64,
    ending_gold: f64,
    survived: u32,
    expected_troops: f64,
    expected_tiles: f64,
) -> f64 {
    begin_call();
    score_counterfactual_action_outcome(
        action_outcome(
            action,
            starting_troops,
            ending_troops,
            max_troops,
            starting_tiles,
            ending_tiles,
            starting_gold,
            ending_gold,
            survived,
        ),
        expected_troops,
        expected_tiles,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_normalize_action_reward(
    reward: f64,
    baseline_mean: f64,
    baseline_samples: u32,
) -> u32 {
    begin_call();
    let result = normalize_action_reward(
        reward,
        ActionRewardBaseline {
            mean: baseline_mean,
            samples: baseline_samples,
        },
    );
    set_result([result.baseline.samples]);
    set_f64_result([result.learning_signal, result.baseline.mean]);
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_apply_action_outcome_learning(
    aggression: f64,
    caution: f64,
    naval: f64,
    action: u32,
    reward: f64,
    prior_samples: f64,
    attribution_weight: f64,
) -> u32 {
    begin_call();
    let result = apply_action_outcome_learning(
        ActionOutcomeGenes {
            aggression,
            caution,
            naval,
        },
        PredictionAction::from_code(action),
        reward,
        prior_samples,
        attribution_weight,
    );
    set_f64_result([result.aggression, result.caution, result.naval]);
    1
}
