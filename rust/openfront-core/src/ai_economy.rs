//! Deterministic economic placement and system-planning policy math.
//!
//! The policy deliberately values compounding infrastructure: productive rail
//! reuse, capacity growth, and trade throughput. Existing tracks get a strong
//! but bounded bonus because inserting a trade station into a live network can
//! turn passing trains into recurring gold without paying for a parallel route.

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EconomicSystemAction {
    Bank = 0,
    ProtectAssets = 1,
    StackCapacity = 2,
    ActivateRail = 3,
    ExtendTrade = 4,
}

impl EconomicSystemAction {
    pub const fn from_code(code: u32) -> Self {
        match code {
            1 => Self::ProtectAssets,
            2 => Self::StackCapacity,
            3 => Self::ActivateRail,
            4 => Self::ExtendTrade,
            _ => Self::Bank,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CityStackPlacementScore {
    pub score: f64,
    pub nearby_cities: u32,
    pub nearest_city_distance: Option<f64>,
    pub stacked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FactoryPlacementScore {
    pub score: f64,
    pub productive_stops: f64,
    pub rail_efficiency: f64,
    pub rail_reuse_score: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CapacityEscapeCityBudget {
    pub spendable_gold: f64,
    pub bypass_bank: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EconomicSystemContext {
    pub gold: f64,
    pub income_per_minute: f64,
    pub reserve_ratio: f64,
    pub incoming_troop_ratio: f64,
    pub hostile_fronts: f64,
    pub active_nation_wars: f64,
    pub has_neutral_land: bool,
    pub trapped: bool,
    pub cities: f64,
    pub desired_cities: f64,
    pub stacked_cities: f64,
    pub factories: f64,
    pub productive_factory_stops: f64,
    pub isolated_factories: f64,
    pub ports: f64,
    pub factory_connected_ports: f64,
    pub unconnected_ports: f64,
    pub trade_partners: f64,
    pub embargoed_partners: f64,
    pub rail_stops: f64,
    pub connected_rail_stops: f64,
    pub defense_posts: f64,
    pub strategic_structures: f64,
    pub exposed_economic_structures: f64,
    pub city_cost: f64,
    pub factory_cost: f64,
    pub port_cost: f64,
    pub defense_post_cost: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EconomicSystemPlan {
    pub action: EconomicSystemAction,
    pub score: f64,
    pub scores: [f64; 5],
    pub risk: f64,
    pub gold_reserve_floor: f64,
    pub spendable_gold: f64,
    pub economy_return_score: f64,
    pub infrastructure_need_score: f64,
    pub trade_coverage_target_ratio: f64,
    pub capital_deployment_pressure: f64,
}

#[inline]
fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

/// Score the rail-specific growth value of a city candidate.
///
/// A normal legal rail connection keeps the previous value. Direct overlap is
/// deliberately more valuable because a city inserted into an existing line is
/// a trade stop that trains are forced to visit when the rail network is split
/// through it. The bonus is capped so track reuse cannot rescue a bad site.
pub fn rail_city_growth_score(rail_connections: u32, overlapping_railroads: u32) -> f64 {
    let connections = rail_connections as f64;
    let overlap = overlapping_railroads.min(2) as f64;
    let direct_stop_bonus = overlap * 45.0;
    let network_leverage = if overlap > 0.0 {
        rail_connections.min(4) as f64 * 10.0
    } else {
        0.0
    };
    connections * 20.0 + direct_stop_bonus + network_leverage
}

pub fn score_city_stack_placement(
    nearest_city_distance: Option<f64>,
    nearby_cities: u32,
    structure_min_distance: f64,
) -> CityStackPlacementScore {
    let minimum = structure_min_distance.max(1.0);
    let Some(nearest) = nearest_city_distance.filter(|distance| distance.is_finite() && *distance >= 0.0)
    else {
        return CityStackPlacementScore {
            score: 0.0,
            nearby_cities,
            nearest_city_distance: None,
            stacked: false,
        };
    };

    let stack_radius = minimum * 2.25;
    let stacked = nearest >= minimum * 0.95 && nearest <= stack_radius;
    if !stacked {
        return CityStackPlacementScore {
            score: 0.0,
            nearby_cities,
            nearest_city_distance: Some(nearest),
            stacked: false,
        };
    }

    let ideal_distance = minimum * 1.1;
    let radial_accuracy = 1.0
        - clamp(
            (nearest - ideal_distance).abs() / (stack_radius - ideal_distance).max(1.0),
            0.0,
            1.0,
        );
    CityStackPlacementScore {
        score: radial_accuracy * 100.0 + nearby_cities.min(3) as f64 * 24.0,
        nearby_cities,
        nearest_city_distance: Some(nearest),
        stacked: true,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn score_factory_placement(
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
    nearest_factory_distance: Option<f64>,
    minimum_range: f64,
    maximum_range: f64,
) -> FactoryPlacementScore {
    let own_stop_value = own_cities.max(0.0) + own_ports.max(0.0) * 1.3;
    let external_stop_value = external_cities.max(0.0) * 1.25 + external_ports.max(0.0) * 1.6;
    let productive_stops = own_cities.max(0.0)
        + own_ports.max(0.0)
        + external_cities.max(0.0)
        + external_ports.max(0.0);
    let routes = route_count.max(0.0);
    let path_tiles = path_tiles.max(0.0);
    let maximum = maximum_range.max(minimum_range.max(1.0));
    let rail_efficiency = if routes <= 0.0 {
        0.0
    } else {
        clamp(
            1.0
                - rail_bends.max(0.0) / (path_tiles - routes).max(1.0)
                - (path_tiles / (routes * maximum.max(1.0)).max(1.0)) * 0.2,
            0.0,
            1.0,
        )
    };
    let safety = clamp(depth.max(0.0) / safest_depth.max(1.0), 0.0, 1.0);
    let minimum = minimum_range.max(1.0);
    let redundancy_threshold = minimum.max(maximum * 0.35);
    let redundancy_penalty = nearest_factory_distance
        .filter(|distance| distance.is_finite() && *distance >= 0.0 && *distance < redundancy_threshold)
        .map(|distance| {
            40.0
                * (1.0
                    - (distance - minimum).max(0.0)
                        / (maximum * 0.35 - minimum).max(1.0))
        })
        .unwrap_or(0.0);

    // Existing rail is recurring-capital leverage. Reward it more strongly than
    // a fresh ghost route, but cap both the raw reuse and the stop interaction.
    let overlap = overlapping_railroads.max(0.0).min(3.0);
    let direct_reuse = overlap * 32.0;
    let reuse_stop_leverage = overlap.min(1.0) * productive_stops.min(4.0) * 6.0;
    let throughput_leverage = (productive_stops * rail_efficiency * 8.0).min(48.0);
    let rail_reuse_score = direct_reuse + reuse_stop_leverage + throughput_leverage;

    FactoryPlacementScore {
        score: own_stop_value * 22.0
            + external_stop_value * 30.0
            + factory_corridor_connections.max(0.0) * 8.0
            + routes.min(3.0) * 12.0
            + rail_efficiency * 24.0
            + safety * 24.0
            + rail_reuse_score
            - redundancy_penalty,
        productive_stops,
        rail_efficiency,
        rail_reuse_score,
    }
}

pub fn estimate_trade_route_gold(distance: f64, short_range_debuff: f64) -> f64 {
    (75_000.0 / (1.0 + (-0.03 * (distance - short_range_debuff)).exp()) + 50.0 * distance)
        .floor()
}

#[allow(clippy::too_many_arguments)]
pub fn capacity_escape_city_budget(
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
) -> CapacityEscapeCityBudget {
    let capacity_blocked = required_troops > max_troops * 1.02;
    let affordable_from_treasury = city_cost > 0.0 && gold >= city_cost;
    let needs_city = cities < desired_cities;
    let multi_front_capacity_risk = hostile_fronts + active_nation_wars >= 4.0 && reserve_ratio >= 0.68;
    let bypass_bank = (capacity_blocked || multi_front_capacity_risk)
        && affordable_from_treasury
        && needs_city
        && incoming_fronts <= 0.0;
    CapacityEscapeCityBudget {
        spendable_gold: if bypass_bank {
            gold
        } else {
            protected_spendable_gold
        },
        bypass_bank,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn should_fund_first_pressure_factory(
    factories: f64,
    cities: f64,
    owned_tiles: f64,
    reserve_ratio: f64,
    incoming_fronts: f64,
    hostile_fronts: f64,
    active_nation_wars: f64,
    no_growth_ticks: f64,
    unconnected_ports: f64,
) -> bool {
    let early_growth_unlock = owned_tiles >= 5_000.0
        && (no_growth_ticks >= 300.0 || unconnected_ports > 0.0);
    let territory_ready = owned_tiles >= 8_000.0 || early_growth_unlock;
    factories <= 0.0
        && cities >= 1.0
        && territory_ready
        && reserve_ratio >= 0.58
        && incoming_fronts <= 0.0
        && (no_growth_ticks >= 180.0
            || hostile_fronts + active_nation_wars >= 2.0
            || unconnected_ports > 0.0)
}

fn positive_costs(context: EconomicSystemContext) -> [f64; 4] {
    [
        context.city_cost,
        context.factory_cost,
        context.port_cost,
        context.defense_post_cost,
    ]
}

pub fn plan_economic_systems(context: EconomicSystemContext) -> EconomicSystemPlan {
    let risk = clamp(
        context
            .incoming_troop_ratio
            .max(context.active_nation_wars / 3.0)
            .max(context.hostile_fronts / 5.0),
        0.0,
        1.0,
    );
    let costs = positive_costs(context);
    let mut minimum_build_cost = f64::INFINITY;
    let mut economic_cost_total = 0.0;
    let mut economic_cost_count = 0.0;
    for (index, cost) in costs.into_iter().enumerate() {
        if cost.is_finite() && cost > 0.0 {
            minimum_build_cost = minimum_build_cost.min(cost);
            if index < 3 {
                economic_cost_total += cost;
                economic_cost_count += 1.0;
            }
        }
    }
    if !minimum_build_cost.is_finite() {
        minimum_build_cost = 0.0;
    }
    let average_economic_cost = if economic_cost_count > 0.0 {
        economic_cost_total / economic_cost_count
    } else {
        minimum_build_cost
    };
    let replacement_reserve = context.exposed_economic_structures.max(0.0) * average_economic_cost * 0.35;
    let income_reserve = context.income_per_minute.max(0.0) * (0.75 + risk * 1.75);
    let gold_reserve_floor = minimum_build_cost.max(income_reserve).max(replacement_reserve);
    let spendable_gold = (context.gold - gold_reserve_floor).max(0.0);

    let structure_count = context.strategic_structures.max(1.0);
    let exposure_ratio = clamp(context.exposed_economic_structures / structure_count, 0.0, 1.0);
    let city_gap = (context.desired_cities - context.cities).max(0.0);
    let unstacked_ratio = if context.cities <= 1.0 {
        0.0
    } else {
        clamp((context.cities - context.stacked_cities) / context.cities, 0.0, 1.0)
    };
    let rail_coverage = if context.rail_stops <= 0.0 {
        0.0
    } else {
        clamp(context.connected_rail_stops / context.rail_stops, 0.0, 1.0)
    };
    let productive_stops_per_factory = if context.factories <= 0.0 {
        0.0
    } else {
        context.productive_factory_stops / context.factories
    };
    let known_trade_relationships = context.trade_partners.max(0.0) + context.embargoed_partners.max(0.0);
    let embargo_ratio = if known_trade_relationships <= 0.0 {
        0.0
    } else {
        clamp(context.embargoed_partners / known_trade_relationships, 0.0, 1.0)
    };
    let trade_coverage_target_ratio = clamp(
        0.05
            + (1.0 - embargo_ratio) * 0.06
            + clamp(context.reserve_ratio, 0.0, 1.0) * 0.05
            + (1.0 - risk) * 0.04,
        0.05,
        0.2,
    );
    let desired_ports = if context.trade_partners <= 0.0 {
        0.0
    } else {
        (context.trade_partners * trade_coverage_target_ratio).ceil().max(1.0)
    };
    let port_gap = (desired_ports - context.ports).max(0.0);
    let unconnected_ports = context.unconnected_ports.max(0.0);
    let rail_gap = 1.0 - rail_coverage;
    let unconnected_port_ratio = if context.ports <= 0.0 {
        0.0
    } else {
        clamp(unconnected_ports / context.ports, 0.0, 1.0)
    };
    let isolated_factory_ratio = if context.factories <= 0.0 {
        0.0
    } else {
        clamp(context.isolated_factories / context.factories, 0.0, 1.0)
    };

    let affordability_penalty = |cost: f64| -> f64 {
        if cost <= spendable_gold {
            0.0
        } else {
            -(20.0 + (cost - spendable_gold) / 25_000.0).min(60.0)
        }
    };

    // Deep surplus capital should be deployed into systems that compound. This
    // remains bounded and vanishes when no positive build cost exists.
    let capital_deployment_pressure = if minimum_build_cost > 0.0 {
        clamp(spendable_gold / (minimum_build_cost * 4.0), 0.0, 1.0)
    } else {
        0.0
    };
    let healthy_growth_reserve = clamp((context.reserve_ratio - 0.5) / 0.4, 0.0, 1.0);
    let growth_readiness = healthy_growth_reserve * (1.0 - risk * 0.65);

    let bank = (if spendable_gold <= 0.0 { 80.0 } else { 0.0 })
        + (if context.reserve_ratio < 0.4 { 50.0 } else { 0.0 })
        + risk * 30.0
        - capital_deployment_pressure * growth_readiness * 18.0;
    let protect_assets = exposure_ratio * 55.0
        + risk * 35.0
        + (context.exposed_economic_structures.max(0.0) * 3.0).min(18.0)
        + if context.defense_posts <= 0.0 && context.exposed_economic_structures > 0.0 {
            10.0
        } else {
            0.0
        }
        + affordability_penalty(context.defense_post_cost);
    let stack_capacity = city_gap * 16.0
        + unstacked_ratio * 28.0
        + if context.trapped { 15.0 } else { 0.0 }
        + if context.reserve_ratio < 0.55 { 10.0 } else { 0.0 }
        - if context.has_neutral_land && !context.trapped { 6.0 } else { 0.0 }
        + capital_deployment_pressure * growth_readiness * 10.0
        + city_gap.min(4.0) * healthy_growth_reserve * 4.0
        + affordability_penalty(context.city_cost);
    let activate_rail = (if context.rail_stops >= 2.0 && context.factories <= 0.0 {
        48.0
    } else {
        0.0
    }) + if context.factories > 0.0 {
        rail_gap * 45.0
    } else {
        0.0
    } + (productive_stops_per_factory.max(0.0) * 2.0).min(8.0) * rail_gap
        + unconnected_port_ratio * 40.0
        + isolated_factory_ratio * 32.0
        + capital_deployment_pressure * growth_readiness * 18.0
        + affordability_penalty(context.factory_cost);
    let extend_trade = port_gap * 20.0
        + (context.trade_partners.max(0.0) * 3.0).min(18.0)
        + (productive_stops_per_factory.max(0.0) * 4.0).min(16.0)
        - unconnected_ports * 22.0
        - embargo_ratio * 35.0
        - risk * 15.0
        + capital_deployment_pressure * growth_readiness * 14.0
        + affordability_penalty(context.port_cost);

    let scores = [bank, protect_assets, stack_capacity, activate_rail, extend_trade];
    let mut action = EconomicSystemAction::Bank;
    let mut score = scores[0];
    if spendable_gold > 0.0 {
        for (index, candidate) in scores.iter().copied().enumerate().skip(1) {
            if candidate > score {
                score = candidate;
                action = EconomicSystemAction::from_code(index as u32);
            }
        }
    }

    EconomicSystemPlan {
        action,
        score,
        scores,
        risk,
        gold_reserve_floor,
        spendable_gold,
        economy_return_score: activate_rail.max(extend_trade) / 10.0,
        infrastructure_need_score: protect_assets.max(stack_capacity) / 10.0,
        trade_coverage_target_ratio,
        capital_deployment_pressure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_context() -> EconomicSystemContext {
        EconomicSystemContext {
            gold: 4_000_000.0,
            income_per_minute: 100_000.0,
            reserve_ratio: 0.82,
            incoming_troop_ratio: 0.0,
            hostile_fronts: 1.0,
            active_nation_wars: 0.0,
            has_neutral_land: false,
            trapped: false,
            cities: 4.0,
            desired_cities: 5.0,
            stacked_cities: 3.0,
            factories: 0.0,
            productive_factory_stops: 0.0,
            isolated_factories: 0.0,
            ports: 1.0,
            factory_connected_ports: 0.0,
            unconnected_ports: 1.0,
            trade_partners: 4.0,
            embargoed_partners: 0.0,
            rail_stops: 5.0,
            connected_rail_stops: 1.0,
            defense_posts: 1.0,
            strategic_structures: 6.0,
            exposed_economic_structures: 0.0,
            city_cost: 250_000.0,
            factory_cost: 250_000.0,
            port_cost: 250_000.0,
            defense_post_cost: 100_000.0,
        }
    }

    #[test]
    fn existing_rail_is_a_strong_but_bounded_city_growth_signal() {
        let off_track = rail_city_growth_score(1, 0);
        let on_track = rail_city_growth_score(1, 1);
        let many_tracks = rail_city_growth_score(1, 10);
        assert!(on_track > off_track + 40.0);
        assert!(many_tracks < on_track + 60.0);
    }

    #[test]
    fn factory_reuse_beats_equivalent_new_route() {
        let fresh = score_factory_placement(
            2.0, 0.0, 1.0, 0.0, 0.0, 0.0, 120.0, 2.0, 2.0, 8.0, 10.0, None, 15.0, 110.0,
        );
        let reused = score_factory_placement(
            2.0, 0.0, 1.0, 0.0, 0.0, 1.0, 120.0, 2.0, 2.0, 8.0, 10.0, None, 15.0, 110.0,
        );
        assert!(reused.score > fresh.score + 40.0);
        assert!(reused.rail_reuse_score > fresh.rail_reuse_score);
    }

    #[test]
    fn stalled_midgame_can_unlock_first_factory_earlier() {
        assert!(should_fund_first_pressure_factory(
            0.0, 2.0, 5_500.0, 0.7, 0.0, 1.0, 0.0, 320.0, 0.0,
        ));
        assert!(!should_fund_first_pressure_factory(
            0.0, 2.0, 5_500.0, 0.7, 0.0, 1.0, 0.0, 120.0, 0.0,
        ));
    }

    #[test]
    fn deep_safe_capital_prefers_compounding_network_over_banking() {
        let plan = plan_economic_systems(base_context());
        assert_eq!(plan.action, EconomicSystemAction::ActivateRail);
        assert!(plan.capital_deployment_pressure > 0.8);
        assert!(plan.scores[EconomicSystemAction::ActivateRail as usize] > plan.scores[0]);
    }

    #[test]
    fn trade_route_formula_matches_engine_shape() {
        assert_eq!(estimate_trade_route_gold(300.0, 300.0), 52_500.0);
        assert!(estimate_trade_route_gold(600.0, 300.0) > estimate_trade_route_gold(300.0, 300.0));
    }
}
