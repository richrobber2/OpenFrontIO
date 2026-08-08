#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum AdaptivePortAction {
    Hold = 0,
    Connect = 1,
    Defend = 2,
    Repair = 3,
    Trade = 4,
}

#[derive(Debug, Clone, Copy)]
pub struct AdaptivePortContext {
    pub reserve_ratio: f64,
    pub incoming_pressure_ratio: f64,
    pub active_front_ratio: f64,
    pub gold: f64,
    pub spendable_gold: f64,
    pub port_cost: f64,
    pub ports: f64,
    pub connected_ports: f64,
    pub trade_partners: f64,
    pub embargoed_partners: f64,
    pub own_warships: f64,
    pub desired_warships: f64,
    pub hostile_warships: f64,
    pub hostile_transports: f64,
    pub trade_targets: f64,
    pub damaged_warships: f64,
    pub dock_capacity: f64,
    pub transport_loss_rate: f64,
    pub rail_productivity_ratio: f64,
    pub naval_bias: f64,
    pub economic_trade_coverage_target_ratio: Option<f64>,
}

#[derive(Debug, Clone, Copy)]
pub struct AdaptivePortPlan {
    pub action: AdaptivePortAction,
    pub urgency: f64,
    pub scores: [f64; 5],
    pub connected_port_ratio: f64,
    pub fleet_coverage_ratio: f64,
    pub repair_load_ratio: f64,
    pub naval_threat_ratio: f64,
    pub trade_coverage_ratio: f64,
    pub budget_coverage_ratio: f64,
    pub target_partner_coverage_ratio: f64,
    pub candidate_sample_ratio: f64,
    pub target_coverage_ratio: f64,
    pub minimum_site_quality: f64,
    pub minimum_budget_coverage: f64,
    pub required_return_ratio: f64,
    pub maximum_payback_ticks: f64,
    pub repair_health_threshold: f64,
    pub stacking_load_threshold: f64,
    pub require_factory_connection: bool,
    pub construction_pressure: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct AdaptiveTradePortOption {
    pub expected_gold: f64,
    pub build_cost: f64,
    pub route_distance: f64,
    pub closest_friendly_port_distance: f64,
    pub factory_connected: bool,
    pub survival_ratio: f64,
    pub spawn_interval_ticks: f64,
    pub reachable_partners: f64,
    pub partner_concentration: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct AdaptiveTradePortNormalization {
    pub minimum_route: f64,
    pub maximum_route: f64,
    pub minimum_spacing: f64,
    pub maximum_spacing: f64,
    pub minimum_gold_rate: f64,
    pub maximum_gold_rate: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct AdaptiveTradePortThresholds {
    pub minimum_site_quality: f64,
    pub required_return_ratio: f64,
    pub maximum_payback_ticks: f64,
    pub require_factory_connection: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct AdaptiveTradePortScore {
    pub eligible: bool,
    pub score: f64,
    pub return_ratio: f64,
    pub distance_efficiency: f64,
    pub spacing_quality: f64,
    pub expected_gold_per_tick: f64,
    pub payback_ticks: f64,
    pub diversity_quality: f64,
}

#[inline]
fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

#[inline]
fn ratio(part: f64, whole: f64, fallback: f64) -> f64 {
    if whole <= 0.0 {
        fallback
    } else {
        part.max(0.0) / whole.max(0.000_001)
    }
}

#[inline]
fn normalize(value: f64, minimum: f64, maximum: f64) -> f64 {
    if maximum <= minimum {
        1.0
    } else {
        clamp((value - minimum) / (maximum - minimum), 0.0, 1.0)
    }
}

#[inline]
fn action_score(scores: &[f64; 5], action: AdaptivePortAction) -> f64 {
    scores[action as usize]
}

pub fn plan_adaptive_port_actions(context: AdaptivePortContext) -> AdaptivePortPlan {
    let reserve_health = clamp((context.reserve_ratio - 0.3) / 0.7, 0.0, 1.0);
    let front_pressure = clamp(
        context
            .incoming_pressure_ratio
            .max(context.active_front_ratio),
        0.0,
        1.0,
    );
    let budget_coverage_ratio = ratio(context.spendable_gold, context.port_cost, 0.0);
    let budget_readiness = clamp(budget_coverage_ratio, 0.0, 1.0);
    let treasury_coverage_ratio = ratio(context.gold, context.port_cost, 0.0);
    let treasury_depth = clamp(treasury_coverage_ratio / 3.0, 0.0, 1.0);
    let connected_port_ratio = if context.ports <= 0.0 {
        1.0
    } else {
        clamp(ratio(context.connected_ports, context.ports, 0.0), 0.0, 1.0)
    };
    let connection_gap = if context.ports <= 0.0 {
        0.0
    } else {
        1.0 - connected_port_ratio
    };
    let fleet_coverage_ratio = if context.desired_warships <= 0.0 {
        1.0
    } else {
        clamp(
            ratio(context.own_warships, context.desired_warships, 0.0),
            0.0,
            1.0,
        )
    };
    let fleet_gap = 1.0 - fleet_coverage_ratio;
    let weighted_hostiles =
        context.hostile_warships.max(0.0) + context.hostile_transports.max(0.0) * 0.75;
    let naval_threat_ratio = clamp(
        ratio(
            weighted_hostiles,
            weighted_hostiles + context.own_warships.max(0.0) + 1.0,
            0.0,
        ),
        0.0,
        1.0,
    );
    let repair_load_ratio = ratio(
        context.damaged_warships,
        context.dock_capacity.max(1.0),
        0.0,
    );
    let repair_pressure = clamp((repair_load_ratio - 0.5) / 1.5, 0.0, 1.0);
    let transport_survival_ratio = 1.0 - clamp(context.transport_loss_rate, 0.0, 1.0);
    let relationship_count = context.trade_partners.max(0.0) + context.embargoed_partners.max(0.0);
    let accessible_trade_ratio = if relationship_count <= 0.0 {
        0.0
    } else {
        clamp(
            ratio(context.trade_partners, relationship_count, 0.0),
            0.0,
            1.0,
        )
    };
    let normalized_naval_bias = clamp(context.naval_bias / 2.0, 0.0, 1.0);
    let adaptive_trade_coverage_target = 0.04
        + budget_readiness * 0.08
        + normalized_naval_bias * 0.06
        + transport_survival_ratio * 0.04;
    let target_partner_coverage_ratio = clamp(
        match context.economic_trade_coverage_target_ratio {
            Some(target) => (adaptive_trade_coverage_target + target) / 2.0,
            None => adaptive_trade_coverage_target,
        },
        0.04,
        0.22,
    );
    let desired_trade_coverage = (context.trade_partners * target_partner_coverage_ratio).max(1.0);
    let trade_coverage_ratio = if context.trade_partners <= 0.0 {
        1.0
    } else {
        clamp(
            ratio(context.connected_ports, desired_trade_coverage, 0.0),
            0.0,
            1.0,
        )
    };
    let trade_target_pressure = clamp(
        ratio(
            context.trade_targets,
            context.trade_targets + context.own_warships + 1.0,
            0.0,
        ),
        0.0,
        1.0,
    );
    let trade_demand = accessible_trade_ratio * (1.0 - trade_coverage_ratio) * transport_survival_ratio;
    let rail_productivity = clamp(context.rail_productivity_ratio, 0.0, 1.0);

    let mut scores = [0.0; 5];
    scores[AdaptivePortAction::Hold as usize] = (1.0 - budget_readiness) * 0.35
        + (1.0 - reserve_health) * 0.3
        + front_pressure * 0.25
        + (1.0
            - connection_gap
                .max(fleet_gap)
                .max(repair_pressure)
                .max(trade_demand)
                .max(naval_threat_ratio))
            * 0.1;
    scores[AdaptivePortAction::Connect as usize] = connection_gap
        * (0.55
            + rail_productivity * 0.15
            + budget_readiness * 0.15
            + reserve_health * 0.1
            + (1.0 - front_pressure) * 0.05);
    scores[AdaptivePortAction::Defend as usize] = naval_threat_ratio * 0.4
        + fleet_gap * 0.25
        + naval_threat_ratio.max(fleet_gap)
            * (budget_readiness * 0.15
                + reserve_health * 0.1
                + transport_survival_ratio * 0.1);
    scores[AdaptivePortAction::Repair as usize] = repair_pressure
        * (0.5
            + naval_threat_ratio * 0.2
            + budget_readiness * 0.15
            + reserve_health * 0.1
            + rail_productivity * 0.05);
    scores[AdaptivePortAction::Trade as usize] = trade_demand * 0.35
        + trade_target_pressure * 0.15
        + trade_demand.max(trade_target_pressure)
            * (rail_productivity * 0.15
                + transport_survival_ratio * 0.1
                + budget_readiness * 0.15
                + normalized_naval_bias * 0.1);

    let mut ranked_action = AdaptivePortAction::Hold;
    for candidate in [
        AdaptivePortAction::Connect,
        AdaptivePortAction::Defend,
        AdaptivePortAction::Repair,
        AdaptivePortAction::Trade,
    ] {
        if action_score(&scores, candidate) > action_score(&scores, ranked_action) {
            ranked_action = candidate;
        }
    }
    let action = if connection_gap > 0.0
        && action_score(&scores, AdaptivePortAction::Connect)
            > action_score(&scores, AdaptivePortAction::Hold)
    {
        AdaptivePortAction::Connect
    } else {
        ranked_action
    };
    let urgency = clamp(
        action_score(&scores, action)
            * (1.0 - action_score(&scores, AdaptivePortAction::Hold) * 0.35)
            + if action == AdaptivePortAction::Defend {
                naval_threat_ratio * 0.2
            } else {
                0.0
            },
        0.0,
        1.0,
    );
    let candidate_sample_ratio = clamp(0.12 + urgency * 0.35, 0.12, 0.47);
    let target_coverage_ratio = clamp(0.15 + urgency * 0.55, 0.15, 0.7);
    let minimum_site_quality = clamp(0.62 - urgency * 0.22, 0.4, 0.62);
    let minimum_budget_coverage = clamp(
        1.5 - urgency * 0.5 + front_pressure * 0.15,
        1.0,
        1.65,
    );
    let treasury_adjusted_budget_coverage =
        clamp(minimum_budget_coverage - treasury_depth * 0.08, 1.0, 1.65);
    let required_return_ratio = clamp(
        0.28 + front_pressure * 0.12 + (1.0 - transport_survival_ratio) * 0.12
            - budget_readiness * 0.06,
        0.18,
        0.52,
    );
    let maximum_payback_ticks = clamp(
        3_600.0 + treasury_depth * 1_800.0
            - front_pressure * 1_500.0
            - (1.0 - transport_survival_ratio) * 1_200.0,
        1_200.0,
        5_400.0,
    );
    let repair_health_threshold = clamp(0.7 + naval_threat_ratio * 0.22, 0.7, 0.92);
    let stacking_load_threshold = clamp(1.35 - urgency * 0.25, 1.1, 1.35);
    let require_factory_connection = action != AdaptivePortAction::Defend || naval_threat_ratio < 0.7;

    AdaptivePortPlan {
        action,
        urgency,
        scores,
        connected_port_ratio,
        fleet_coverage_ratio,
        repair_load_ratio,
        naval_threat_ratio,
        trade_coverage_ratio,
        budget_coverage_ratio,
        target_partner_coverage_ratio,
        candidate_sample_ratio,
        target_coverage_ratio,
        minimum_site_quality,
        minimum_budget_coverage: treasury_adjusted_budget_coverage,
        required_return_ratio,
        maximum_payback_ticks,
        repair_health_threshold,
        stacking_load_threshold,
        require_factory_connection,
        construction_pressure: urgency,
    }
}

pub fn score_adaptive_trade_port_option(
    thresholds: AdaptiveTradePortThresholds,
    option: AdaptiveTradePortOption,
    normalization: AdaptiveTradePortNormalization,
) -> AdaptiveTradePortScore {
    let return_ratio = ratio(option.expected_gold, option.build_cost, 0.0);
    let survival = clamp(option.survival_ratio, 0.0, 1.0);
    let expected_gold_per_tick = (option.expected_gold.max(0.0) * survival)
        / (option.route_distance + option.spawn_interval_ticks).max(1.0);
    let payback_ticks = ratio(option.build_cost, expected_gold_per_tick, f64::INFINITY);
    let return_quality = clamp(
        return_ratio / (thresholds.required_return_ratio * 2.0).max(0.000_001),
        0.0,
        1.0,
    );
    let distance_efficiency = 1.0
        - normalize(
            option.route_distance,
            normalization.minimum_route,
            normalization.maximum_route,
        );
    let spacing_quality = normalize(
        option.closest_friendly_port_distance,
        normalization.minimum_spacing,
        normalization.maximum_spacing,
    );
    let diversity_quality = clamp(
        clamp(option.reachable_partners / 4.0, 0.0, 1.0) * 0.6
            + (1.0 - clamp(option.partner_concentration, 0.0, 1.0)) * 0.4,
        0.0,
        1.0,
    );
    let throughput_quality = normalize(
        expected_gold_per_tick,
        normalization.minimum_gold_rate,
        normalization.maximum_gold_rate,
    );
    let payback_quality = clamp(
        1.0 - payback_ticks / thresholds.maximum_payback_ticks.max(1.0),
        0.0,
        1.0,
    );

    // Distance exposure was historically calculated but omitted from the score.
    // Keep it modest because throughput already accounts for travel time, while
    // still preferring a shorter equally-productive route when everything else
    // is genuinely equal.
    let score = return_quality * 0.22
        + if option.factory_connected { 0.14 } else { 0.0 }
        + throughput_quality * 0.25
        + payback_quality * 0.20
        + diversity_quality * 0.10
        + spacing_quality * 0.04
        + distance_efficiency * 0.05;
    let eligible = (!thresholds.require_factory_connection || option.factory_connected)
        && return_ratio >= thresholds.required_return_ratio
        && payback_ticks <= thresholds.maximum_payback_ticks
        && score >= thresholds.minimum_site_quality;

    AdaptiveTradePortScore {
        eligible,
        score,
        return_ratio,
        distance_efficiency,
        spacing_quality,
        expected_gold_per_tick,
        payback_ticks,
        diversity_quality,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn safe_context() -> AdaptivePortContext {
        AdaptivePortContext {
            reserve_ratio: 0.82,
            incoming_pressure_ratio: 0.0,
            active_front_ratio: 0.15,
            gold: 4_000_000.0,
            spendable_gold: 2_000_000.0,
            port_cost: 250_000.0,
            ports: 2.0,
            connected_ports: 2.0,
            trade_partners: 12.0,
            embargoed_partners: 1.0,
            own_warships: 5.0,
            desired_warships: 4.0,
            hostile_warships: 1.0,
            hostile_transports: 1.0,
            trade_targets: 10.0,
            damaged_warships: 0.0,
            dock_capacity: 2.0,
            transport_loss_rate: 0.08,
            rail_productivity_ratio: 0.85,
            naval_bias: 1.2,
            economic_trade_coverage_target_ratio: Some(0.15),
        }
    }

    #[test]
    fn safe_connected_economy_prefers_trade_growth() {
        let plan = plan_adaptive_port_actions(safe_context());
        assert_eq!(plan.action, AdaptivePortAction::Trade);
        assert!(plan.scores[AdaptivePortAction::Trade as usize] > plan.scores[0]);
        assert!(plan.required_return_ratio < 0.3);
    }

    #[test]
    fn unconnected_ports_force_connection_when_it_beats_holding() {
        let mut context = safe_context();
        context.ports = 3.0;
        context.connected_ports = 0.0;
        context.trade_targets = 0.0;
        let plan = plan_adaptive_port_actions(context);
        assert_eq!(plan.action, AdaptivePortAction::Connect);
        assert!(plan.connected_port_ratio < 0.01);
    }

    #[test]
    fn heavy_naval_pressure_prefers_defense_over_trade() {
        let mut context = safe_context();
        context.incoming_pressure_ratio = 0.9;
        context.active_front_ratio = 0.8;
        context.reserve_ratio = 0.42;
        context.own_warships = 1.0;
        context.desired_warships = 6.0;
        context.hostile_warships = 9.0;
        context.hostile_transports = 5.0;
        let plan = plan_adaptive_port_actions(context);
        assert_eq!(plan.action, AdaptivePortAction::Defend);
        assert!(plan.required_return_ratio > 0.3);
    }

    #[test]
    fn equally_productive_shorter_trade_route_wins_on_exposure() {
        let thresholds = AdaptiveTradePortThresholds {
            minimum_site_quality: 0.0,
            required_return_ratio: 0.1,
            maximum_payback_ticks: 10_000.0,
            require_factory_connection: true,
        };
        let normalization = AdaptiveTradePortNormalization {
            minimum_route: 100.0,
            maximum_route: 300.0,
            minimum_spacing: 100.0,
            maximum_spacing: 100.0,
            minimum_gold_rate: 100.0,
            maximum_gold_rate: 100.0,
        };
        let short = score_adaptive_trade_port_option(
            thresholds,
            AdaptiveTradePortOption {
                expected_gold: 60_000.0,
                build_cost: 250_000.0,
                route_distance: 100.0,
                closest_friendly_port_distance: 100.0,
                factory_connected: true,
                survival_ratio: 1.0,
                spawn_interval_ticks: 500.0,
                reachable_partners: 3.0,
                partner_concentration: 0.5,
            },
            normalization,
        );
        let long = score_adaptive_trade_port_option(
            thresholds,
            AdaptiveTradePortOption {
                route_distance: 300.0,
                spawn_interval_ticks: 300.0,
                ..AdaptiveTradePortOption {
                    expected_gold: 60_000.0,
                    build_cost: 250_000.0,
                    route_distance: 100.0,
                    closest_friendly_port_distance: 100.0,
                    factory_connected: true,
                    survival_ratio: 1.0,
                    spawn_interval_ticks: 500.0,
                    reachable_partners: 3.0,
                    partner_concentration: 0.5,
                }
            },
            normalization,
        );
        assert!(short.score > long.score);
        assert!((short.score - long.score - 0.05).abs() < 1e-9);
    }
}
