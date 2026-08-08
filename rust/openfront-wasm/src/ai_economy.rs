use openfront_core::{
    capacity_escape_city_budget, estimate_trade_route_gold, plan_economic_systems,
    rail_city_growth_score, score_city_stack_placement, score_factory_placement,
    should_fund_first_pressure_factory, EconomicSystemContext,
};

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_rail_city_growth_score(
    rail_connections: u32,
    overlapping_railroads: u32,
) -> f64 {
    begin_call();
    rail_city_growth_score(rail_connections, overlapping_railroads)
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_score_city_stack_placement(
    has_nearest_city: u32,
    nearest_city_distance: f64,
    nearby_cities: u32,
    structure_min_distance: f64,
) -> u32 {
    begin_call();
    let score = score_city_stack_placement(
        if has_nearest_city != 0 {
            Some(nearest_city_distance)
        } else {
            None
        },
        nearby_cities,
        structure_min_distance,
    );
    set_result([
        score.nearby_cities,
        if score.stacked { 1 } else { 0 },
        if score.nearest_city_distance.is_some() { 1 } else { 0 },
    ]);
    set_f64_result([score.score, score.nearest_city_distance.unwrap_or(0.0)]);
    1
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_score_factory_placement(
    own_cities: f64,
    own_ports: f64,
    external_cities: f64,
    external_ports: f64,
    factory_corridor_connections: f64,
    overlapping_railroads: f64,
    path_tiles: f64,
    route_count: f64,
    rail_bends: f64,
    depth: f64,
    safest_depth: f64,
    has_nearest_factory: u32,
    nearest_factory_distance: f64,
    minimum_range: f64,
    maximum_range: f64,
) -> u32 {
    begin_call();
    let score = score_factory_placement(
        own_cities,
        own_ports,
        external_cities,
        external_ports,
        factory_corridor_connections,
        overlapping_railroads,
        path_tiles,
        route_count,
        rail_bends,
        depth,
        safest_depth,
        if has_nearest_factory != 0 {
            Some(nearest_factory_distance)
        } else {
            None
        },
        minimum_range,
        maximum_range,
    );
    set_f64_result([
        score.score,
        score.productive_stops,
        score.rail_efficiency,
        score.rail_reuse_score,
    ]);
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_estimate_trade_route_gold(
    distance: f64,
    short_range_debuff: f64,
) -> f64 {
    begin_call();
    estimate_trade_route_gold(distance, short_range_debuff)
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_capacity_escape_city_budget(
    gold: f64,
    protected_spendable_gold: f64,
    city_cost: f64,
    cities: f64,
    desired_cities: f64,
    required_troops: f64,
    max_troops: f64,
    incoming_fronts: f64,
    hostile_fronts: f64,
    active_nation_wars: f64,
    reserve_ratio: f64,
) -> u32 {
    begin_call();
    let budget = capacity_escape_city_budget(
        gold,
        protected_spendable_gold,
        city_cost,
        cities,
        desired_cities,
        required_troops,
        max_troops,
        incoming_fronts,
        hostile_fronts,
        active_nation_wars,
        reserve_ratio,
    );
    set_result([if budget.bypass_bank { 1 } else { 0 }]);
    set_f64_result([budget.spendable_gold]);
    1
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_should_fund_first_pressure_factory(
    factories: f64,
    cities: f64,
    owned_tiles: f64,
    reserve_ratio: f64,
    incoming_fronts: f64,
    hostile_fronts: f64,
    active_nation_wars: f64,
    no_growth_ticks: f64,
    unconnected_ports: f64,
) -> u32 {
    begin_call();
    if should_fund_first_pressure_factory(
        factories,
        cities,
        owned_tiles,
        reserve_ratio,
        incoming_fronts,
        hostile_fronts,
        active_nation_wars,
        no_growth_ticks,
        unconnected_ports,
    ) {
        1
    } else {
        0
    }
}

#[allow(clippy::too_many_arguments)]
#[unsafe(no_mangle)]
pub extern "C" fn openfront_ai_plan_economic_systems(
    gold: f64,
    income_per_minute: f64,
    reserve_ratio: f64,
    incoming_troop_ratio: f64,
    hostile_fronts: f64,
    active_nation_wars: f64,
    has_neutral_land: u32,
    trapped: u32,
    cities: f64,
    desired_cities: f64,
    stacked_cities: f64,
    factories: f64,
    productive_factory_stops: f64,
    isolated_factories: f64,
    ports: f64,
    factory_connected_ports: f64,
    unconnected_ports: f64,
    trade_partners: f64,
    embargoed_partners: f64,
    rail_stops: f64,
    connected_rail_stops: f64,
    defense_posts: f64,
    strategic_structures: f64,
    exposed_economic_structures: f64,
    city_cost: f64,
    factory_cost: f64,
    port_cost: f64,
    defense_post_cost: f64,
) -> u32 {
    begin_call();
    let plan = plan_economic_systems(EconomicSystemContext {
        gold,
        income_per_minute,
        reserve_ratio,
        incoming_troop_ratio,
        hostile_fronts,
        active_nation_wars,
        has_neutral_land: has_neutral_land != 0,
        trapped: trapped != 0,
        cities,
        desired_cities,
        stacked_cities,
        factories,
        productive_factory_stops,
        isolated_factories,
        ports,
        factory_connected_ports,
        unconnected_ports,
        trade_partners,
        embargoed_partners,
        rail_stops,
        connected_rail_stops,
        defense_posts,
        strategic_structures,
        exposed_economic_structures,
        city_cost,
        factory_cost,
        port_cost,
        defense_post_cost,
    });
    set_result([plan.action as u32]);
    set_f64_result([
        plan.score,
        plan.scores[0],
        plan.scores[1],
        plan.scores[2],
        plan.scores[3],
        plan.scores[4],
        plan.risk,
        plan.gold_reserve_floor,
        plan.spendable_gold,
        plan.economy_return_score,
        plan.infrastructure_need_score,
        plan.trade_coverage_target_ratio,
        plan.capital_deployment_pressure,
    ]);
    1
}
