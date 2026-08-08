use openfront_core::{
    evaluate_coalition_target, model_opponent, plan_strategic_action, CoalitionHelper, OpponentModel,
    PredictedChoice, StrategicPlanInput,
};

const AI_COALITION_HELPER_RECORD_BYTES: usize = 24;
const AI_OPPONENT_RECORD_BYTES: usize = 24;

#[inline]
fn read_f64_le(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ])
}

#[inline]
fn read_u32_le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

/// Evaluate helper eligibility and coalition value for one reachable target.
///
/// Helper upload layout is `count` 24-byte little-endian records:
/// `[reliability:f64, reserve_ratio:f64, can_reach:u32, treaty_blocked:u32]`.
/// `RESULT_F64` becomes `[score, offensive_cost_multiplier]` and `RESULT`
/// becomes `[available_count, treaty_blocked_count, helper_state...]`, where
/// helper state is 0 unavailable, 1 available, or 2 treaty blocked.
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_coalition_target_evaluate(
    base_priority: f64,
    enemy_active_wars: u32,
    upload_handle: u32,
    count: u32,
) -> u32 {
    begin_call();

    let parsed = UPLOADS.with(|uploads| -> Result<Vec<CoalitionHelper>, ErrorCode> {
        let uploads = uploads.borrow();
        let index = slot_index(upload_handle).ok_or(ErrorCode::InvalidHandle)?;
        let upload = uploads
            .get(index)
            .and_then(|slot| slot.as_ref())
            .ok_or(ErrorCode::InvalidHandle)?;
        let required = (count as usize)
            .checked_mul(AI_COALITION_HELPER_RECORD_BYTES)
            .ok_or(ErrorCode::AiCoalitionRecordLengthMismatch)?;
        if upload.len() < required {
            return Err(ErrorCode::AiCoalitionRecordLengthMismatch);
        }

        Ok(upload[..required]
            .chunks_exact(AI_COALITION_HELPER_RECORD_BYTES)
            .map(|record| CoalitionHelper {
                reliability: read_f64_le(record, 0),
                reserve_ratio: read_f64_le(record, 8),
                can_reach: read_u32_le(record, 16) != 0,
                treaty_blocked: read_u32_le(record, 20) != 0,
            })
            .collect())
    });

    let helpers = match parsed {
        Ok(helpers) => helpers,
        Err(error) => {
            fail(error);
            return 0;
        }
    };

    let evaluation = evaluate_coalition_target(base_priority, enemy_active_wars, &helpers);
    set_f64_result([evaluation.score, evaluation.offensive_cost_multiplier]);
    set_result(
        [
            evaluation.available_helpers as u32,
            evaluation.treaty_blocked_helpers as u32,
        ]
        .into_iter()
        .chain(evaluation.helper_states),
    );
    1
}

/// Model one opponent entirely in Rust. The result lanes are:
/// `[troop_ratio, territory_ratio, territory_growth_rate, troop_growth_rate,
/// growth_pressure, military_pressure, silo_count, naval_pressure]`.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_model_opponent(
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
    predicted_choice: u32,
    forecast_threat: f64,
) -> u32 {
    begin_call();
    let predicted_choice = match predicted_choice {
        1 => PredictedChoice::Expand,
        2 => PredictedChoice::Economy,
        3 => PredictedChoice::Attack,
        _ => PredictedChoice::Other,
    };
    let opponent = model_opponent(
        troops,
        max_troops,
        tiles,
        own_tiles,
        incoming_attacks,
        outgoing_attacks,
        silos,
        warships,
        previous_tiles,
        previous_troops,
        elapsed_ticks,
        predicted_choice,
        forecast_threat,
    );
    set_f64_result([
        opponent.troop_ratio,
        opponent.territory_ratio,
        opponent.territory_growth_rate,
        opponent.troop_growth_rate,
        opponent.growth_pressure,
        opponent.military_pressure,
        opponent.silo_count,
        opponent.naval_pressure,
    ]);
    1
}

/// Choose the top-level strategic action in Rust.
///
/// Opponent upload layout is `count` 24-byte little-endian records:
/// `[military_pressure:f64, growth_pressure:f64, silo_count:f64]`.
/// `RESULT` becomes `[action, strongest_opponent_index, critical_defense]`.
/// `RESULT_F64` becomes the six action scores followed by incoming troop ratio.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_plan_strategic_action(
    reserve_ratio: f64,
    incoming_fronts: u32,
    incoming_troops: f64,
    max_troops: f64,
    has_neutral_land: u32,
    hostile_borders: u32,
    active_nation_wars: u32,
    naval_threats: u32,
    trade_targets: u32,
    naval_pressure_ratio: f64,
    trade_opportunity_ratio: f64,
    ready_strategic_slots: u32,
    affordable_strategic_weapons: u32,
    actionable_strike_targets: u32,
    upload_handle: u32,
    count: u32,
) -> u32 {
    begin_call();

    let parsed = UPLOADS.with(|uploads| -> Result<Vec<OpponentModel>, ErrorCode> {
        let uploads = uploads.borrow();
        let index = slot_index(upload_handle).ok_or(ErrorCode::InvalidHandle)?;
        let upload = uploads
            .get(index)
            .and_then(|slot| slot.as_ref())
            .ok_or(ErrorCode::InvalidHandle)?;
        let required = (count as usize)
            .checked_mul(AI_OPPONENT_RECORD_BYTES)
            .ok_or(ErrorCode::AiOpponentRecordLengthMismatch)?;
        if upload.len() < required {
            return Err(ErrorCode::AiOpponentRecordLengthMismatch);
        }

        Ok(upload[..required]
            .chunks_exact(AI_OPPONENT_RECORD_BYTES)
            .map(|record| OpponentModel {
                troop_ratio: 0.0,
                territory_ratio: 0.0,
                territory_growth_rate: 0.0,
                troop_growth_rate: 0.0,
                military_pressure: read_f64_le(record, 0),
                growth_pressure: read_f64_le(record, 8),
                silo_count: read_f64_le(record, 16),
                naval_pressure: 0.0,
            })
            .collect())
    });

    let opponents = match parsed {
        Ok(opponents) => opponents,
        Err(error) => {
            fail(error);
            return 0;
        }
    };

    let plan = plan_strategic_action(
        StrategicPlanInput {
            reserve_ratio,
            incoming_fronts,
            incoming_troops,
            max_troops,
            has_neutral_land: has_neutral_land != 0,
            hostile_borders,
            active_nation_wars,
            naval_threats,
            trade_targets,
            naval_pressure_ratio: if naval_pressure_ratio.is_nan() {
                None
            } else {
                Some(naval_pressure_ratio)
            },
            trade_opportunity_ratio,
            ready_strategic_slots,
            affordable_strategic_weapons,
            actionable_strike_targets,
        },
        &opponents,
    );

    set_result([
        plan.action as u32,
        plan.strongest_opponent_index
            .map(|index| index as u32)
            .unwrap_or(INVALID_RESULT),
        if plan.critical_defense { 1 } else { 0 },
    ]);
    set_f64_result(plan.scores.into_iter().chain([plan.incoming_troop_ratio]));
    1
}
