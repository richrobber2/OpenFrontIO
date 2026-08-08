//! Deterministic tactical AI policy math.
//!
//! These helpers intentionally accept already-observed game state. TypeScript
//! remains responsible for GameView/event wiring while Rust owns the repeated
//! combat, reserve, alliance, and fleet decisions.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AttackCapacity {
    pub required_troops: f64,
    pub reachable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CapacityEscapeRaidPlan {
    pub fraction: f64,
    pub target_gain_ratio: f64,
    pub deadline_ticks: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NationFrontPolicy {
    pub reserve_floor: f64,
    pub advantage_multiplier: f64,
    pub max_nation_offensives: u32,
    pub desired_alliances: u32,
}

pub fn assess_attack_capacity(
    max_troops: f64,
    target_troops: f64,
    required_advantage: f64,
) -> AttackCapacity {
    let required_troops = (target_troops * required_advantage).max(0.0);
    AttackCapacity {
        required_troops,
        reachable: required_troops <= max_troops.max(0.0),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn plan_capacity_escape_raid(
    no_growth_ticks: u32,
    reserve_ratio: f64,
    reserve_floor: f64,
    incoming_fronts: u32,
    outgoing_fronts: u32,
    required_capacity_ratio: f64,
    terrain_cost: f64,
) -> Option<CapacityEscapeRaidPlan> {
    let protected_reserve = 0.72_f64.max(reserve_floor + 0.08);
    if no_growth_ticks < 240
        || incoming_fronts > 0
        || outgoing_fronts > 0
        || reserve_ratio < 0.84_f64.max(protected_reserve + 0.06)
        || required_capacity_ratio <= 1.0
        || required_capacity_ratio > 3.0
        || !terrain_cost.is_finite()
        || terrain_cost > 2.25
    {
        return None;
    }

    let available_fraction =
        (reserve_ratio - protected_reserve) / reserve_ratio.max(0.01);
    let fraction = available_fraction.max(0.0).min(0.12);
    if fraction < 0.06 {
        return None;
    }

    Some(CapacityEscapeRaidPlan {
        fraction,
        target_gain_ratio: (0.003 + no_growth_ticks.saturating_sub(240) as f64 / 200_000.0)
            .min(0.006),
        deadline_ticks: (42.0 + no_growth_ticks as f64 / 120.0)
            .max(42.0)
            .min(72.0),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn desired_capacity_escape_city_count(
    baseline_desired_cities: u32,
    owned_cities: u32,
    no_growth_ticks: u32,
    reserve_ratio: f64,
    incoming_fronts: u32,
    max_troops: f64,
    required_troops: f64,
    city_troop_increase: f64,
) -> u32 {
    if no_growth_ticks < 180
        || reserve_ratio < 0.72
        || incoming_fronts > 0
        || required_troops <= max_troops
    {
        return baseline_desired_cities;
    }

    let gap_cities = ((required_troops * 1.05 - max_troops) / city_troop_increase.max(1.0))
        .ceil()
        .max(1.0) as u32;
    let paced_cities = (((no_growth_ticks as f64 - 120.0) / 480.0).ceil().max(1.0) as u32)
        .min(6);
    baseline_desired_cities
        .max(owned_cities.saturating_add(gap_cities.min(paced_cities)))
        .min(16)
}

#[allow(clippy::too_many_arguments)]
pub fn should_accept_alliance(
    available_alliance_slots: u32,
    active_conflict: bool,
    requestor_is_tribe: bool,
    preserves_best_expansion_route: bool,
    closes_dangerous_front: bool,
    useful_remote_partner: bool,
    crowded_borders: bool,
) -> bool {
    available_alliance_slots > 0
        && !active_conflict
        && !requestor_is_tribe
        && preserves_best_expansion_route
        && (closes_dangerous_front || useful_remote_partner || crowded_borders)
}

pub fn is_strategically_trapped(
    has_neutral_land: bool,
    has_sea_access: bool,
    hostile_borders: u32,
) -> bool {
    !has_neutral_land && !has_sea_access && hostile_borders > 0
}

pub fn desired_factory_count(
    economic_stops: u32,
    owned_cities: u32,
    owned_tiles: u32,
    gold: f64,
    reserve_ratio: f64,
) -> u32 {
    if economic_stops < 2 || owned_cities < 2 {
        return 0;
    }
    if owned_cities >= 10 && owned_tiles >= 12_000 && gold >= 5_000_000.0 && reserve_ratio >= 0.65 {
        return 3;
    }
    if owned_cities >= 6 && owned_tiles >= 6_000 && gold >= 2_000_000.0 && reserve_ratio >= 0.55 {
        return 2;
    }
    1
}

pub fn should_build_capacity_city(
    reserve_ratio: f64,
    has_neutral_land: bool,
    trapped: bool,
    rail_connections: u32,
) -> bool {
    trapped || rail_connections > 0 || !has_neutral_land || reserve_ratio >= 0.72
}

#[allow(clippy::too_many_arguments)]
pub fn desired_defensive_city_count(
    enemy_fronts: u32,
    active_wars: u32,
    incoming_fronts: u32,
    owned_cities: u32,
    owned_tiles: u32,
    reserve_ratio: f64,
    incoming_troop_ratio: f64,
) -> u32 {
    let hostile_pressure = enemy_fronts as f64 * 1.5
        + active_wars as f64 * 2.0
        + incoming_fronts as f64 * 2.5;
    let territory_baseline = ((owned_tiles as f64 / 1_000.0).ceil() - 1.0).max(0.0) as u32;
    let reserve_buffer = u32::from(reserve_ratio < 0.5);
    let overwhelming_buffer = ((incoming_troop_ratio - 0.5).max(0.0) * 2.0).ceil() as u32;
    let pressure_cities = (hostile_pressure / 2.0).ceil() as u32;

    owned_cities.max(
        pressure_cities
            .saturating_add(territory_baseline)
            .saturating_add(reserve_buffer)
            .saturating_add(overwhelming_buffer)
            .min(16),
    )
}

pub fn tribe_attack_commitment_multiplier(attacker_troops: f64, defender_troops: f64) -> f64 {
    if attacker_troops >= defender_troops.max(1.0) * 2.0 {
        2.0
    } else {
        1.08
    }
}

pub fn should_trade_land_for_time(
    reserve_ratio: f64,
    incoming_troop_ratio: f64,
    active_incoming_fronts: u32,
) -> bool {
    reserve_ratio <= 0.5 && incoming_troop_ratio < 0.75 && active_incoming_fronts > 0
}

pub fn nation_front_policy(nation_fronts: u32, active_nation_wars: u32) -> NationFrontPolicy {
    let extra_fronts = nation_fronts.saturating_sub(1);
    NationFrontPolicy {
        reserve_floor: (0.48 + extra_fronts as f64 * 0.08 + active_nation_wars as f64 * 0.08)
            .min(0.8),
        advantage_multiplier: (1.25
            + extra_fronts as f64 * 0.15
            + active_nation_wars as f64 * 0.12)
            .min(1.9),
        max_nation_offensives: 1,
        desired_alliances: if nation_fronts >= 3 {
            2
        } else if nation_fronts > 0 {
            1
        } else {
            0
        },
    }
}

pub fn nation_land_front_allowed(
    is_nation: bool,
    target_in_border_war: bool,
    target_in_offensive: bool,
    active_border_war_count: u32,
    active_offensive_count: u32,
    max_nation_offensives: u32,
) -> bool {
    !is_nation
        || target_in_border_war
        || target_in_offensive
        || (active_border_war_count == 0 && active_offensive_count < max_nation_offensives)
}

pub fn should_risk_denial_raid(
    is_tribe: bool,
    nation_borders: u32,
    target_troops: f64,
    our_troops: f64,
    target_distracted: bool,
    reserve_ratio: f64,
) -> bool {
    if is_tribe {
        return true;
    }
    let target_troop_ratio = target_troops.max(0.0) / our_troops.max(1.0);
    if nation_borders >= 4 {
        return reserve_ratio >= 0.9 && target_distracted && target_troop_ratio <= 0.75;
    }
    if nation_borders == 3 {
        return reserve_ratio >= 0.84
            && target_troop_ratio <= 1.0
            && (target_distracted || target_troop_ratio <= 0.65);
    }
    true
}

pub fn desired_banked_troops(
    max_troops: f64,
    enemy_troops: f64,
    enemy_max_troops: Option<f64>,
    enemy_fronts: u32,
    reserve_floor: f64,
    is_tribe: bool,
) -> f64 {
    let safe_capacity = max_troops.max(0.0) * reserve_floor.max(0.0);
    if is_tribe {
        return (max_troops.max(0.0) * 0.75)
            .min(safe_capacity.max(enemy_troops.max(0.0) * 0.5));
    }

    let front_slowdown_ratio =
        (1.0 + enemy_fronts.saturating_sub(1) as f64 * 0.2).min(1.5);
    let current_capture_threat = enemy_troops.max(0.0) * front_slowdown_ratio;
    let future_capture_threat = enemy_max_troops.unwrap_or(enemy_troops).max(0.0) * 0.65;
    (max_troops.max(0.0) * 0.92).min(
        safe_capacity
            .max(current_capture_threat)
            .max(future_capture_threat),
    )
}

pub fn desired_fleet_troop_bank(
    max_troops: f64,
    nearby_hostile_warships: u32,
    own_warships: u32,
    has_trade_target: bool,
) -> f64 {
    let base = if has_trade_target { 0.2 } else { 0.28 };
    let escort_penalty = if nearby_hostile_warships > own_warships {
        0.08
    } else {
        0.0
    };
    (max_troops.max(0.0) * (base - escort_penalty).max(0.1)).floor()
}

pub fn desired_warship_count(
    nearby_hostile_warships: u32,
    nearby_hostile_transports: u32,
    vulnerable_trade_ships: u32,
    naval_bias: f64,
) -> u32 {
    let defensive_demand = (nearby_hostile_warships + (nearby_hostile_transports + 1) / 2).min(8);
    let raiding_demand = if vulnerable_trade_ships > 0 {
        (1 + ((vulnerable_trade_ships + 4) / 5).min(1)
            + (naval_bias.max(0.0) * 0.25).round() as u32)
            .min(3)
    } else {
        0
    };
    defensive_demand.max(raiding_demand)
}

pub fn minimum_defense_post_depth(can_create_land_buffer: bool, defense_range: f64) -> f64 {
    (defense_range * if can_create_land_buffer { 0.35 } else { 0.7 })
        .floor()
        .max(2.0)
}

#[allow(clippy::too_many_arguments)]
pub fn estimate_land_attack_ticks(
    attacker_troops: f64,
    defender_troops: f64,
    fraction: f64,
    border_width: f64,
    combat_cost: f64,
    tiles_to_take: f64,
) -> f64 {
    let committed_troops = (attacker_troops * fraction).max(1.0);
    let relative_progress = ((10.0 * committed_troops) / defender_troops.max(1.0))
        .max(0.01)
        .min(0.5);
    let progress_budget_per_tick = relative_progress * border_width.max(1.0) * 3.0;
    let defender_resistance = (defender_troops.max(0.0) / (5.0 * committed_troops))
        .max(0.2)
        .min(1.5)
        / 0.5;
    let effective_tiles_per_tick = progress_budget_per_tick / (combat_cost.max(0.5) * defender_resistance);
    (tiles_to_take.max(1.0) / effective_tiles_per_tick).ceil()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attack_capacity_reports_required_bank() {
        let result = assess_attack_capacity(100.0, 60.0, 1.5);
        assert_eq!(result.required_troops, 90.0);
        assert!(result.reachable);
        assert!(!assess_attack_capacity(80.0, 60.0, 1.5).reachable);
    }

    #[test]
    fn escape_raid_requires_a_safe_full_bank() {
        assert!(plan_capacity_escape_raid(239, 1.0, 0.48, 0, 0, 1.5, 1.0).is_none());
        let plan = plan_capacity_escape_raid(360, 1.0, 0.48, 0, 0, 1.5, 1.0).unwrap();
        assert!((plan.fraction - 0.12).abs() < 1e-12);
        assert!(plan.target_gain_ratio > 0.003);
    }

    #[test]
    fn alliances_require_a_safe_useful_partner() {
        assert!(should_accept_alliance(1, false, false, true, true, false, false));
        assert!(!should_accept_alliance(1, true, false, true, true, true, true));
        assert!(!should_accept_alliance(1, false, true, true, true, true, true));
    }

    #[test]
    fn nation_front_policy_scales_reserve_and_allies() {
        let policy = nation_front_policy(4, 1);
        assert_eq!(policy.max_nation_offensives, 1);
        assert_eq!(policy.desired_alliances, 2);
        assert!((policy.reserve_floor - 0.8).abs() < 1e-12);
        assert!((policy.advantage_multiplier - 1.82).abs() < 1e-12);
    }

    #[test]
    fn denial_raids_get_stricter_on_crowded_borders() {
        assert!(should_risk_denial_raid(false, 2, 100.0, 100.0, false, 0.5));
        assert!(!should_risk_denial_raid(false, 4, 80.0, 100.0, true, 0.89));
        assert!(should_risk_denial_raid(false, 4, 70.0, 100.0, true, 0.9));
    }

    #[test]
    fn defensive_bank_accounts_for_future_capture_threat() {
        assert_eq!(
            desired_banked_troops(1_000.0, 600.0, Some(900.0), 2, 0.48, false),
            720.0
        );
        assert_eq!(
            desired_banked_troops(1_000.0, 600.0, Some(900.0), 2, 0.48, true),
            480.0
        );
    }

    #[test]
    fn fleet_policy_builds_escorts_and_raiders() {
        assert_eq!(desired_fleet_troop_bank(1_000.0, 3, 1, true), 120.0);
        assert_eq!(desired_warship_count(1, 5, 12, 2.0), 4);
        assert_eq!(desired_warship_count(0, 0, 1, 0.0), 2);
    }

    #[test]
    fn city_pressure_and_land_attack_estimate_match_policy_shape() {
        assert_eq!(
            desired_defensive_city_count(2, 1, 1, 3, 4_000, 0.4, 0.8),
            9
        );
        assert_eq!(
            estimate_land_attack_ticks(1_000.0, 500.0, 0.2, 4.0, 1.0, 100.0),
            17.0
        );
    }
}
