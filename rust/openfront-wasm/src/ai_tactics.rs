use openfront_core::{
    assess_attack_capacity, desired_banked_troops, desired_capacity_escape_city_count,
    desired_defensive_city_count, desired_factory_count, desired_fleet_troop_bank,
    desired_warship_count, estimate_land_attack_ticks, is_strategically_trapped,
    minimum_defense_post_depth, nation_front_policy, nation_land_front_allowed,
    plan_capacity_escape_raid, should_accept_alliance, should_build_capacity_city,
    should_risk_denial_raid, should_trade_land_for_time, tribe_attack_commitment_multiplier,
};

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_assess_attack_capacity(
    max_troops: f64,
    target_troops: f64,
    required_advantage: f64,
) -> u32 {
    begin_call();
    let result = assess_attack_capacity(max_troops, target_troops, required_advantage);
    set_f64_result([result.required_troops]);
    set_result([u32::from(result.reachable)]);
    1
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_plan_capacity_escape_raid(
    no_growth_ticks: u32,
    reserve_ratio: f64,
    reserve_floor: f64,
    incoming_fronts: u32,
    outgoing_fronts: u32,
    required_capacity_ratio: f64,
    terrain_cost: f64,
) -> u32 {
    begin_call();
    match plan_capacity_escape_raid(
        no_growth_ticks,
        reserve_ratio,
        reserve_floor,
        incoming_fronts,
        outgoing_fronts,
        required_capacity_ratio,
        terrain_cost,
    ) {
        Some(plan) => {
            set_result([1]);
            set_f64_result([plan.fraction, plan.target_gain_ratio, plan.deadline_ticks]);
        }
        None => {
            set_result([0]);
            set_f64_result([0.0, 0.0, 0.0]);
        }
    }
    1
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_desired_capacity_escape_city_count(
    baseline_desired_cities: u32,
    owned_cities: u32,
    no_growth_ticks: u32,
    reserve_ratio: f64,
    incoming_fronts: u32,
    max_troops: f64,
    required_troops: f64,
    city_troop_increase: f64,
) -> u32 {
    begin_call();
    desired_capacity_escape_city_count(
        baseline_desired_cities,
        owned_cities,
        no_growth_ticks,
        reserve_ratio,
        incoming_fronts,
        max_troops,
        required_troops,
        city_troop_increase,
    )
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_should_accept_alliance(
    available_alliance_slots: u32,
    active_conflict: u32,
    requestor_is_tribe: u32,
    preserves_best_expansion_route: u32,
    closes_dangerous_front: u32,
    useful_remote_partner: u32,
    crowded_borders: u32,
) -> u32 {
    begin_call();
    u32::from(should_accept_alliance(
        available_alliance_slots,
        active_conflict != 0,
        requestor_is_tribe != 0,
        preserves_best_expansion_route != 0,
        closes_dangerous_front != 0,
        useful_remote_partner != 0,
        crowded_borders != 0,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_is_strategically_trapped(
    has_neutral_land: u32,
    has_sea_access: u32,
    hostile_borders: u32,
) -> u32 {
    begin_call();
    u32::from(is_strategically_trapped(
        has_neutral_land != 0,
        has_sea_access != 0,
        hostile_borders,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_desired_factory_count(
    economic_stops: u32,
    owned_cities: u32,
    owned_tiles: u32,
    gold: f64,
    reserve_ratio: f64,
) -> u32 {
    begin_call();
    desired_factory_count(
        economic_stops,
        owned_cities,
        owned_tiles,
        gold,
        reserve_ratio,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_should_build_capacity_city(
    reserve_ratio: f64,
    has_neutral_land: u32,
    trapped: u32,
    rail_connections: u32,
) -> u32 {
    begin_call();
    u32::from(should_build_capacity_city(
        reserve_ratio,
        has_neutral_land != 0,
        trapped != 0,
        rail_connections,
    ))
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_desired_defensive_city_count(
    enemy_fronts: u32,
    active_wars: u32,
    incoming_fronts: u32,
    owned_cities: u32,
    owned_tiles: u32,
    reserve_ratio: f64,
    incoming_troop_ratio: f64,
) -> u32 {
    begin_call();
    desired_defensive_city_count(
        enemy_fronts,
        active_wars,
        incoming_fronts,
        owned_cities,
        owned_tiles,
        reserve_ratio,
        incoming_troop_ratio,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_tribe_attack_commitment_multiplier(
    attacker_troops: f64,
    defender_troops: f64,
) -> f64 {
    begin_call();
    tribe_attack_commitment_multiplier(attacker_troops, defender_troops)
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_should_trade_land_for_time(
    reserve_ratio: f64,
    incoming_troop_ratio: f64,
    active_incoming_fronts: u32,
) -> u32 {
    begin_call();
    u32::from(should_trade_land_for_time(
        reserve_ratio,
        incoming_troop_ratio,
        active_incoming_fronts,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_nation_front_policy(
    nation_fronts: u32,
    active_nation_wars: u32,
) -> u32 {
    begin_call();
    let policy = nation_front_policy(nation_fronts, active_nation_wars);
    set_f64_result([policy.reserve_floor, policy.advantage_multiplier]);
    set_result([policy.max_nation_offensives, policy.desired_alliances]);
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_nation_land_front_allowed(
    is_nation: u32,
    target_in_border_war: u32,
    target_in_offensive: u32,
    active_border_war_count: u32,
    active_offensive_count: u32,
    max_nation_offensives: u32,
) -> u32 {
    begin_call();
    u32::from(nation_land_front_allowed(
        is_nation != 0,
        target_in_border_war != 0,
        target_in_offensive != 0,
        active_border_war_count,
        active_offensive_count,
        max_nation_offensives,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_should_risk_denial_raid(
    is_tribe: u32,
    nation_borders: u32,
    target_troops: f64,
    our_troops: f64,
    target_distracted: u32,
    reserve_ratio: f64,
) -> u32 {
    begin_call();
    u32::from(should_risk_denial_raid(
        is_tribe != 0,
        nation_borders,
        target_troops,
        our_troops,
        target_distracted != 0,
        reserve_ratio,
    ))
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_desired_banked_troops(
    max_troops: f64,
    enemy_troops: f64,
    enemy_max_troops: f64,
    enemy_fronts: u32,
    reserve_floor: f64,
    is_tribe: u32,
) -> f64 {
    begin_call();
    desired_banked_troops(
        max_troops,
        enemy_troops,
        if enemy_max_troops.is_nan() {
            None
        } else {
            Some(enemy_max_troops)
        },
        enemy_fronts,
        reserve_floor,
        is_tribe != 0,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_desired_fleet_troop_bank(
    max_troops: f64,
    nearby_hostile_warships: u32,
    own_warships: u32,
    has_trade_target: u32,
) -> f64 {
    begin_call();
    desired_fleet_troop_bank(
        max_troops,
        nearby_hostile_warships,
        own_warships,
        has_trade_target != 0,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_desired_warship_count(
    nearby_hostile_warships: u32,
    nearby_hostile_transports: u32,
    vulnerable_trade_ships: u32,
    naval_bias: f64,
) -> u32 {
    begin_call();
    desired_warship_count(
        nearby_hostile_warships,
        nearby_hostile_transports,
        vulnerable_trade_ships,
        naval_bias,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_minimum_defense_post_depth(
    can_create_land_buffer: u32,
    defense_range: f64,
) -> f64 {
    begin_call();
    minimum_defense_post_depth(can_create_land_buffer != 0, defense_range)
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_estimate_land_attack_ticks(
    attacker_troops: f64,
    defender_troops: f64,
    fraction: f64,
    border_width: f64,
    combat_cost: f64,
    tiles_to_take: f64,
) -> f64 {
    begin_call();
    estimate_land_attack_ticks(
        attacker_troops,
        defender_troops,
        fraction,
        border_width,
        combat_cost,
        tiles_to_take,
    )
}
