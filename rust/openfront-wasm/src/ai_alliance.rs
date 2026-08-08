use openfront_core::{
    alliance_response_window_ticks, assess_alliance_cooperation, choose_aid_request,
    plan_alliance_lifecycle, plan_coalition_growth_support, plan_communication,
    projected_troop_growth_rate, should_coordinate_attack, should_donate_gold,
    should_donate_troops, AllianceForecastChoice, AllianceLifecycleInput,
    CoalitionGrowthSupportInput,
};

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_projected_troop_growth_rate(
    max_troops: f64,
    troops: f64,
    multiplier: f64,
) -> f64 {
    begin_call();
    projected_troop_growth_rate(max_troops, troops, multiplier)
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_assess_alliance_cooperation(
    requests_answered: u32,
    ignored_requests: u32,
    shared_front_samples: u32,
    shared_front_responses: u32,
    unprompted_aid_events: u32,
    alliance_age_ratio: f64,
) -> u32 {
    begin_call();
    let assessment = assess_alliance_cooperation(
        requests_answered,
        ignored_requests,
        shared_front_samples,
        shared_front_responses,
        unprompted_aid_events,
        alliance_age_ratio,
    );
    set_result([
        if assessment.trusted { 1 } else { 0 },
        if assessment.should_replace { 1 } else { 0 },
        assessment.reason as u32,
    ]);
    set_f64_result([assessment.reliability, assessment.confidence]);
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_alliance_response_window_ticks(
    quick_chat_cooldown_ticks: f64,
    alliance_duration_ticks: f64,
) -> f64 {
    begin_call();
    alliance_response_window_ticks(quick_chat_cooldown_ticks, alliance_duration_ticks)
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_plan_alliance_lifecycle(
    is_same_team: u32,
    other_is_traitor: u32,
    shares_border: u32,
    ticks_until_expiry: f64,
    betrayal_penalty_ticks: f64,
    in_extension_window: u32,
    own_reserve_ratio: f64,
    other_reserve_ratio: f64,
    troop_ratio: f64,
    capacity_ratio: f64,
    territory_ratio: f64,
    alliance_count: u32,
    hostile_nation_borders: u32,
    active_nation_wars: u32,
    incoming_fronts: u32,
    cooperation_reliability: f64,
    cooperation_confidence: f64,
    should_replace_uncooperative_ally: u32,
    replacement_available: u32,
    other_players_alive: f64,
    forecast_choice: u32,
    forecast_threat: f64,
) -> u32 {
    begin_call();
    let forecast_choice = match forecast_choice {
        1 => AllianceForecastChoice::Expand,
        2 => AllianceForecastChoice::Economy,
        3 => AllianceForecastChoice::Attack,
        4 => AllianceForecastChoice::Defend,
        _ => AllianceForecastChoice::Bank,
    };
    let plan = plan_alliance_lifecycle(AllianceLifecycleInput {
        is_same_team: is_same_team != 0,
        other_is_traitor: other_is_traitor != 0,
        shares_border: shares_border != 0,
        ticks_until_expiry,
        betrayal_penalty_ticks,
        in_extension_window: in_extension_window != 0,
        own_reserve_ratio,
        other_reserve_ratio,
        troop_ratio,
        capacity_ratio,
        territory_ratio,
        alliance_count,
        hostile_nation_borders,
        active_nation_wars,
        incoming_fronts,
        cooperation_reliability,
        cooperation_confidence,
        should_replace_uncooperative_ally: should_replace_uncooperative_ally != 0,
        replacement_available: replacement_available != 0,
        other_players_alive,
        forecast_choice,
        forecast_threat,
    });
    set_result([
        plan.action as u32,
        plan.reason as u32,
        if plan.safe_elimination { 1 } else { 0 },
    ]);
    1
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_choose_aid_request(
    reserve_ratio: f64,
    reserve_floor: f64,
    incoming_troop_ratio: f64,
    gold: f64,
    planned_build_cost: f64,
    active_nation_wars: u32,
    has_trusted_ally: u32,
    ticks_since_last_request: f64,
    message_cooldown_ticks: f64,
) -> u32 {
    begin_call();
    choose_aid_request(
        reserve_ratio,
        reserve_floor,
        incoming_troop_ratio,
        gold,
        if planned_build_cost.is_nan() {
            None
        } else {
            Some(planned_build_cost)
        },
        active_nation_wars,
        has_trusted_ally != 0,
        ticks_since_last_request,
        message_cooldown_ticks,
    ) as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_should_donate_troops(
    reserve_ratio: f64,
    reserve_floor: f64,
    active_nation_wars: u32,
    ally_incoming_troop_ratio: f64,
    ally_reserve_ratio: f64,
) -> u32 {
    begin_call();
    if should_donate_troops(
        reserve_ratio,
        reserve_floor,
        active_nation_wars,
        ally_incoming_troop_ratio,
        ally_reserve_ratio,
    ) {
        1
    } else {
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_should_donate_gold(
    gold: f64,
    emergency_gold_floor: f64,
    ally_incoming_troop_ratio: f64,
    ally_reserve_ratio: f64,
) -> u32 {
    begin_call();
    if should_donate_gold(
        gold,
        emergency_gold_floor,
        ally_incoming_troop_ratio,
        ally_reserve_ratio,
    ) {
        1
    } else {
        0
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_should_coordinate_attack(
    own_reserve_ratio: f64,
    ally_reserve_ratio: f64,
    shared_enemy: u32,
    enemy_active_wars: u32,
    own_active_nation_wars: u32,
    ticks_since_last_message: f64,
    message_cooldown_ticks: f64,
) -> u32 {
    begin_call();
    if should_coordinate_attack(
        own_reserve_ratio,
        ally_reserve_ratio,
        shared_enemy != 0,
        enemy_active_wars,
        own_active_nation_wars,
        ticks_since_last_message,
        message_cooldown_ticks,
    ) {
        1
    } else {
        0
    }
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_plan_communication(
    aid_reserve_ratio: f64,
    aid_reserve_floor: f64,
    aid_incoming_troop_ratio: f64,
    aid_gold: f64,
    aid_planned_build_cost: f64,
    aid_active_nation_wars: u32,
    aid_has_trusted_ally: u32,
    aid_ticks_since_last_request: f64,
    donation_reserve_ratio: f64,
    donation_reserve_floor: f64,
    donation_gold: f64,
    donation_emergency_gold_floor: f64,
    donation_active_nation_wars: u32,
    ally_incoming_troop_ratio: f64,
    ally_reserve_ratio: f64,
    coordination_own_reserve_ratio: f64,
    coordination_ally_reserve_ratio: f64,
    coordination_shared_enemy: u32,
    coordination_enemy_active_wars: u32,
    coordination_own_active_nation_wars: u32,
    coordination_ticks_since_last_message: f64,
    own_troops: f64,
    own_max_troops: f64,
    own_gold: f64,
    has_shared_enemy_id: u32,
    received_meaningful_aid: u32,
    ticks_since_last_thanks: f64,
    message_cooldown_ticks: f64,
) -> u32 {
    begin_call();
    let plan = plan_communication(
        aid_reserve_ratio,
        aid_reserve_floor,
        aid_incoming_troop_ratio,
        aid_gold,
        if aid_planned_build_cost.is_nan() {
            None
        } else {
            Some(aid_planned_build_cost)
        },
        aid_active_nation_wars,
        aid_has_trusted_ally != 0,
        aid_ticks_since_last_request,
        donation_reserve_ratio,
        donation_reserve_floor,
        donation_gold,
        donation_emergency_gold_floor,
        donation_active_nation_wars,
        ally_incoming_troop_ratio,
        ally_reserve_ratio,
        coordination_own_reserve_ratio,
        coordination_ally_reserve_ratio,
        coordination_shared_enemy != 0,
        coordination_enemy_active_wars,
        coordination_own_active_nation_wars,
        coordination_ticks_since_last_message,
        own_troops,
        own_max_troops,
        own_gold,
        has_shared_enemy_id != 0,
        received_meaningful_aid != 0,
        ticks_since_last_thanks,
        message_cooldown_ticks,
    );
    set_result([plan.action as u32]);
    set_f64_result([plan.amount]);
    1
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_plan_coalition_growth_support(
    own_troops: f64,
    own_max_troops: f64,
    reserve_floor: f64,
    active_nation_wars: u32,
    incoming_fronts: u32,
    ally_troops: f64,
    ally_max_troops: f64,
    ally_reliability: f64,
    ally_is_nation: u32,
    can_donate: u32,
    ally_has_growth_route: u32,
    ally_committed_troops: f64,
    shared_enemy_troops: f64,
    shared_enemy_max_troops: f64,
    shared_enemy_is_nation: u32,
    ally_can_pressure_shared_enemy: u32,
    own_growth_multiplier: f64,
    enemy_growth_multiplier: f64,
) -> u32 {
    begin_call();
    let decision = plan_coalition_growth_support(CoalitionGrowthSupportInput {
        own_troops,
        own_max_troops,
        reserve_floor,
        active_nation_wars,
        incoming_fronts,
        ally_troops,
        ally_max_troops,
        ally_reliability,
        ally_is_nation: ally_is_nation != 0,
        can_donate: can_donate != 0,
        ally_has_growth_route: ally_has_growth_route != 0,
        ally_committed_troops,
        shared_enemy_troops,
        shared_enemy_max_troops,
        shared_enemy_is_nation: shared_enemy_is_nation != 0,
        ally_can_pressure_shared_enemy: ally_can_pressure_shared_enemy != 0,
        own_growth_multiplier,
        enemy_growth_multiplier: if enemy_growth_multiplier.is_nan() {
            None
        } else {
            Some(enemy_growth_multiplier)
        },
    });
    set_result([
        if decision.donate { 1 } else { 0 },
        decision.purpose as u32,
        decision.reason as u32,
    ]);
    set_f64_result([
        decision.amount,
        decision.own_reserve_after,
        decision.growth_rate_before,
        decision.growth_rate_after,
        decision.growth_rate_gain_ratio,
        decision.enemy_growth_rate_before,
        decision.enemy_growth_rate_after,
        decision.enemy_growth_suppression_ratio,
        decision.projected_enemy_reserve_after,
    ]);
    1
}
