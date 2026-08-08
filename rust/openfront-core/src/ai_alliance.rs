//! Deterministic alliance, diplomacy, and coalition-support policy math.
//!
//! TypeScript keeps player identity and event emission. Rust owns the decision
//! thresholds, scoring, donation sizing, lifecycle choices, and regeneration
//! projections used to decide whether an ally is actually useful.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AllianceCooperationAssessment {
    pub reliability: f64,
    pub confidence: f64,
    pub trusted: bool,
    pub should_replace: bool,
    pub reason: AllianceCooperationReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum AllianceCooperationReason {
    Replace = 0,
    Trusted = 1,
    NeedsEvidence = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum AllianceLifecycleAction {
    Keep = 0,
    Renew = 1,
    DoNotRenew = 2,
    Break = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum AllianceLifecycleReason {
    Team = 0,
    TraitorSafeElimination = 1,
    FinalOpponentBreak = 2,
    FinalOpponentNoRenew = 3,
    ReplaceUncooperative = 4,
    LowReliability = 5,
    EarlySafeBreak = 6,
    BlocksGrowth = 7,
    FutureThreat = 8,
    RenewUseful = 9,
    NoRenewNotUseful = 10,
    KeepUseful = 11,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum AllianceForecastChoice {
    Bank = 0,
    Expand = 1,
    Economy = 2,
    Attack = 3,
    Defend = 4,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AllianceLifecyclePlan {
    pub action: AllianceLifecycleAction,
    pub reason: AllianceLifecycleReason,
    pub safe_elimination: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AllianceLifecycleInput {
    pub is_same_team: bool,
    pub other_is_traitor: bool,
    pub shares_border: bool,
    pub ticks_until_expiry: f64,
    pub betrayal_penalty_ticks: f64,
    pub in_extension_window: bool,
    pub own_reserve_ratio: f64,
    pub other_reserve_ratio: f64,
    pub troop_ratio: f64,
    pub capacity_ratio: f64,
    pub territory_ratio: f64,
    pub alliance_count: u32,
    pub hostile_nation_borders: u32,
    pub active_nation_wars: u32,
    pub incoming_fronts: u32,
    pub cooperation_reliability: f64,
    pub cooperation_confidence: f64,
    pub should_replace_uncooperative_ally: bool,
    pub replacement_available: bool,
    pub other_players_alive: f64,
    pub forecast_choice: AllianceForecastChoice,
    pub forecast_threat: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum AidRequestKind {
    None = 0,
    Gold = 1,
    Troops = 2,
    Defense = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum CommunicationActionKind {
    None = 0,
    RequestGold = 1,
    RequestTroops = 2,
    RequestDefense = 3,
    FocusAttack = 4,
    DonateTroops = 5,
    DonateGold = 6,
    Thanks = 7,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CommunicationPlan {
    pub action: CommunicationActionKind,
    pub amount: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum CoalitionSupportPurpose {
    None = 0,
    Growth = 1,
    Pressure = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum CoalitionSupportReason {
    IllegalRecipient = 0,
    ActiveHomeFront = 1,
    DonorOrAllyReserve = 2,
    NoGrowthRoute = 3,
    LowReliability = 4,
    AllyGrowthHeadroom = 5,
    SurplusTooSmall = 6,
    NoRegenerationGain = 7,
    GrowthInvestment = 8,
    SharedEnemyPressure = 9,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoalitionGrowthSupportInput {
    pub own_troops: f64,
    pub own_max_troops: f64,
    pub reserve_floor: f64,
    pub active_nation_wars: u32,
    pub incoming_fronts: u32,
    pub ally_troops: f64,
    pub ally_max_troops: f64,
    pub ally_reliability: f64,
    pub ally_is_nation: bool,
    pub can_donate: bool,
    pub ally_has_growth_route: bool,
    pub ally_committed_troops: f64,
    pub shared_enemy_troops: f64,
    pub shared_enemy_max_troops: f64,
    pub shared_enemy_is_nation: bool,
    pub ally_can_pressure_shared_enemy: bool,
    pub own_growth_multiplier: f64,
    pub enemy_growth_multiplier: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CoalitionGrowthSupportDecision {
    pub donate: bool,
    pub amount: f64,
    pub purpose: CoalitionSupportPurpose,
    pub own_reserve_after: f64,
    pub growth_rate_before: f64,
    pub growth_rate_after: f64,
    pub growth_rate_gain_ratio: f64,
    pub enemy_growth_rate_before: f64,
    pub enemy_growth_rate_after: f64,
    pub enemy_growth_suppression_ratio: f64,
    pub projected_enemy_reserve_after: f64,
    pub reason: CoalitionSupportReason,
}

#[inline]
fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

/// Mirrors Config.projectedTroopIncreaseRate after the player-type/difficulty
/// modifier has been collapsed into `multiplier`.
pub fn projected_troop_growth_rate(max_troops: f64, troops: f64, multiplier: f64) -> f64 {
    let max = max_troops.max(1.0);
    let projected_troops = clamp(troops, 0.0, max);
    let mut to_add = 10.0 + projected_troops.powf(0.73) / 4.0;
    to_add *= 1.0 - projected_troops / max;
    to_add *= multiplier.max(0.0);
    (projected_troops + to_add).min(max) - projected_troops
}

pub fn assess_alliance_cooperation(
    requests_answered: u32,
    ignored_requests: u32,
    shared_front_samples: u32,
    shared_front_responses: u32,
    unprompted_aid_events: u32,
    alliance_age_ratio: f64,
) -> AllianceCooperationAssessment {
    let resolved_requests = requests_answered + ignored_requests;
    let request_response_rate = if resolved_requests == 0 {
        0.5
    } else {
        requests_answered as f64 / resolved_requests as f64
    };
    let shared_front_response_rate = if shared_front_samples == 0 {
        0.5
    } else {
        shared_front_responses as f64 / shared_front_samples as f64
    };
    let aid_bonus = (unprompted_aid_events as f64 * 0.06).min(0.18);
    let confidence = clamp(
        resolved_requests as f64 / 3.0
            + shared_front_samples as f64 / 12.0
            + clamp(alliance_age_ratio, 0.0, 1.0) * 0.12,
        0.0,
        1.0,
    );
    let reliability = clamp(
        0.5 + (request_response_rate - 0.5) * 0.58
            + (shared_front_response_rate - 0.5) * 0.34
            + aid_bonus,
        0.0,
        1.0,
    );
    let trusted = reliability >= 0.58 && (confidence >= 0.25 || unprompted_aid_events > 0);
    let should_replace = resolved_requests >= 2
        && ignored_requests >= 2
        && confidence >= 0.5
        && reliability < 0.34;
    let reason = if should_replace {
        AllianceCooperationReason::Replace
    } else if trusted {
        AllianceCooperationReason::Trusted
    } else {
        AllianceCooperationReason::NeedsEvidence
    };

    AllianceCooperationAssessment {
        reliability,
        confidence,
        trusted,
        should_replace,
        reason,
    }
}

pub fn alliance_response_window_ticks(
    quick_chat_cooldown_ticks: f64,
    alliance_duration_ticks: f64,
) -> f64 {
    (quick_chat_cooldown_ticks.max(1.0) * 4.0)
        .max(alliance_duration_ticks.max(1.0) * 0.04)
        .ceil()
}

pub fn plan_alliance_lifecycle(input: AllianceLifecycleInput) -> AllianceLifecyclePlan {
    if input.is_same_team {
        return AllianceLifecyclePlan {
            action: if input.in_extension_window {
                AllianceLifecycleAction::Renew
            } else {
                AllianceLifecycleAction::Keep
            },
            reason: AllianceLifecycleReason::Team,
            safe_elimination: false,
        };
    }

    let future_threat = input.forecast_threat
        * if matches!(
            input.forecast_choice,
            AllianceForecastChoice::Expand | AllianceForecastChoice::Economy
        ) {
            1.15
        } else {
            1.0
        };
    let weak_neighbor = input.shares_border
        && input.other_reserve_ratio <= 0.2
        && input.troop_ratio <= 0.18
        && input.capacity_ratio <= 0.28
        && input.territory_ratio <= 0.18;
    let safe_elimination = weak_neighbor
        && input.own_reserve_ratio >= 0.78
        && input.troop_ratio <= 0.12
        && input.capacity_ratio <= 0.2
        && input.territory_ratio <= 0.12
        && input.incoming_fronts == 0
        && input.active_nation_wars == 0
        && input.hostile_nation_borders <= 1;
    let alliance_still_useful = input.incoming_fronts > 0
        || input.hostile_nation_borders + input.active_nation_wars >= 2
        || input.troop_ratio >= 0.65
        || input.capacity_ratio >= 0.7
        || input.territory_ratio >= 0.65
        || future_threat >= 0.75;
    let blocks_growth = input.shares_border
        && (weak_neighbor
            || (input.troop_ratio < 0.4
                && input.capacity_ratio < 0.5
                && input.territory_ratio < 0.45
                && input.alliance_count > 1));

    if input.other_is_traitor && safe_elimination {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::Break,
            reason: AllianceLifecycleReason::TraitorSafeElimination,
            safe_elimination,
        };
    }

    let final_opponent = input.other_players_alive == 1.0;
    if final_opponent
        && input.incoming_fronts == 0
        && input.active_nation_wars == 0
        && input.hostile_nation_borders == 0
        && input.own_reserve_ratio >= 0.9
        && future_threat <= 0.85
        && input.troop_ratio <= 0.9
    {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::Break,
            reason: AllianceLifecycleReason::FinalOpponentBreak,
            safe_elimination: true,
        };
    }
    if final_opponent && input.in_extension_window {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::DoNotRenew,
            reason: AllianceLifecycleReason::FinalOpponentNoRenew,
            safe_elimination: false,
        };
    }
    if input.should_replace_uncooperative_ally
        && input.replacement_available
        && input.cooperation_confidence >= 0.5
        && input.incoming_fronts == 0
        && input.active_nation_wars <= 1
    {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::DoNotRenew,
            reason: AllianceLifecycleReason::ReplaceUncooperative,
            safe_elimination,
        };
    }
    if input.in_extension_window
        && input.cooperation_confidence >= 0.5
        && input.cooperation_reliability < 0.34
        && input.incoming_fronts == 0
        && input.hostile_nation_borders + input.active_nation_wars <= 1
    {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::DoNotRenew,
            reason: AllianceLifecycleReason::LowReliability,
            safe_elimination,
        };
    }
    if safe_elimination
        && input.ticks_until_expiry > input.betrayal_penalty_ticks * 2.0 + 100.0
        && input.hostile_nation_borders == 0
        && future_threat < 0.6
    {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::Break,
            reason: AllianceLifecycleReason::EarlySafeBreak,
            safe_elimination,
        };
    }
    if blocks_growth
        && input.incoming_fronts == 0
        && input.active_nation_wars <= 1
        && input.hostile_nation_borders <= 1
    {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::DoNotRenew,
            reason: AllianceLifecycleReason::BlocksGrowth,
            safe_elimination,
        };
    }
    if future_threat >= 1.15
        && input.forecast_choice != AllianceForecastChoice::Defend
        && input.incoming_fronts == 0
        && input.active_nation_wars <= 1
        && input.hostile_nation_borders <= 1
    {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::DoNotRenew,
            reason: AllianceLifecycleReason::FutureThreat,
            safe_elimination,
        };
    }
    if input.in_extension_window && alliance_still_useful {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::Renew,
            reason: AllianceLifecycleReason::RenewUseful,
            safe_elimination,
        };
    }
    if input.in_extension_window {
        return AllianceLifecyclePlan {
            action: AllianceLifecycleAction::DoNotRenew,
            reason: AllianceLifecycleReason::NoRenewNotUseful,
            safe_elimination,
        };
    }
    AllianceLifecyclePlan {
        action: AllianceLifecycleAction::Keep,
        reason: AllianceLifecycleReason::KeepUseful,
        safe_elimination,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn choose_aid_request(
    reserve_ratio: f64,
    reserve_floor: f64,
    incoming_troop_ratio: f64,
    gold: f64,
    planned_build_cost: Option<f64>,
    active_nation_wars: u32,
    has_trusted_ally: bool,
    ticks_since_last_request: f64,
    message_cooldown_ticks: f64,
) -> AidRequestKind {
    if !has_trusted_ally || ticks_since_last_request < message_cooldown_ticks {
        return AidRequestKind::None;
    }
    if incoming_troop_ratio >= 0.4 || reserve_ratio < 0.25_f64.max(reserve_floor - 0.12) {
        return AidRequestKind::Defense;
    }
    if reserve_ratio < reserve_floor || (active_nation_wars > 0 && reserve_ratio < 0.5) {
        return AidRequestKind::Troops;
    }
    if planned_build_cost.is_some_and(|cost| gold < cost && gold >= 0.0) {
        return AidRequestKind::Gold;
    }
    AidRequestKind::None
}

pub fn should_donate_troops(
    reserve_ratio: f64,
    reserve_floor: f64,
    active_nation_wars: u32,
    ally_incoming_troop_ratio: f64,
    ally_reserve_ratio: f64,
) -> bool {
    active_nation_wars == 0
        && reserve_ratio >= 0.75_f64.max(reserve_floor + 0.2)
        && ally_incoming_troop_ratio >= 0.35
        && ally_reserve_ratio < 0.45
}

pub fn should_donate_gold(
    gold: f64,
    emergency_gold_floor: f64,
    ally_incoming_troop_ratio: f64,
    ally_reserve_ratio: f64,
) -> bool {
    gold > emergency_gold_floor * 1.5
        && ally_incoming_troop_ratio >= 0.25
        && ally_reserve_ratio < 0.5
}

pub fn should_coordinate_attack(
    own_reserve_ratio: f64,
    ally_reserve_ratio: f64,
    shared_enemy: bool,
    enemy_active_wars: u32,
    own_active_nation_wars: u32,
    ticks_since_last_message: f64,
    message_cooldown_ticks: f64,
) -> bool {
    shared_enemy
        && enemy_active_wars > 0
        && own_active_nation_wars == 0
        && own_reserve_ratio >= 0.65
        && ally_reserve_ratio >= 0.55
        && ticks_since_last_message >= message_cooldown_ticks
}

#[allow(clippy::too_many_arguments)]
pub fn plan_communication(
    aid_reserve_ratio: f64,
    aid_reserve_floor: f64,
    aid_incoming_troop_ratio: f64,
    aid_gold: f64,
    aid_planned_build_cost: Option<f64>,
    aid_active_nation_wars: u32,
    aid_has_trusted_ally: bool,
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
    coordination_shared_enemy: bool,
    coordination_enemy_active_wars: u32,
    coordination_own_active_nation_wars: u32,
    coordination_ticks_since_last_message: f64,
    own_troops: f64,
    own_max_troops: f64,
    own_gold: f64,
    has_shared_enemy_id: bool,
    received_meaningful_aid: bool,
    ticks_since_last_thanks: f64,
    message_cooldown_ticks: f64,
) -> CommunicationPlan {
    let requested_aid = choose_aid_request(
        aid_reserve_ratio,
        aid_reserve_floor,
        aid_incoming_troop_ratio,
        aid_gold,
        aid_planned_build_cost,
        aid_active_nation_wars,
        aid_has_trusted_ally,
        aid_ticks_since_last_request,
        message_cooldown_ticks,
    );
    let request = if requested_aid == AidRequestKind::Troops && ally_reserve_ratio < 0.6 {
        AidRequestKind::None
    } else {
        requested_aid
    };
    match request {
        AidRequestKind::Gold => {
            return CommunicationPlan {
                action: CommunicationActionKind::RequestGold,
                amount: 0.0,
            };
        }
        AidRequestKind::Troops => {
            return CommunicationPlan {
                action: CommunicationActionKind::RequestTroops,
                amount: 0.0,
            };
        }
        AidRequestKind::Defense => {
            return CommunicationPlan {
                action: CommunicationActionKind::RequestDefense,
                amount: 0.0,
            };
        }
        AidRequestKind::None => {}
    }

    if has_shared_enemy_id
        && should_coordinate_attack(
            coordination_own_reserve_ratio,
            coordination_ally_reserve_ratio,
            coordination_shared_enemy,
            coordination_enemy_active_wars,
            coordination_own_active_nation_wars,
            coordination_ticks_since_last_message,
            message_cooldown_ticks,
        )
    {
        return CommunicationPlan {
            action: CommunicationActionKind::FocusAttack,
            amount: 0.0,
        };
    }

    if should_donate_troops(
        donation_reserve_ratio,
        donation_reserve_floor,
        donation_active_nation_wars,
        ally_incoming_troop_ratio,
        ally_reserve_ratio,
    ) {
        let reserve_floor_troops = own_max_troops * donation_reserve_floor.max(0.0);
        let surplus = (own_troops - reserve_floor_troops).max(0.0);
        let amount = (own_troops * 0.18).min(surplus * 0.5).floor();
        if amount > 0.0 {
            return CommunicationPlan {
                action: CommunicationActionKind::DonateTroops,
                amount,
            };
        }
    }

    if should_donate_gold(
        donation_gold,
        donation_emergency_gold_floor,
        ally_incoming_troop_ratio,
        ally_reserve_ratio,
    ) {
        let surplus_gold = (own_gold - donation_emergency_gold_floor).max(0.0);
        let amount = (own_gold * 0.2).min(surplus_gold * 0.35).floor();
        if amount > 0.0 {
            return CommunicationPlan {
                action: CommunicationActionKind::DonateGold,
                amount,
            };
        }
    }

    if received_meaningful_aid && ticks_since_last_thanks >= 180.0 {
        return CommunicationPlan {
            action: CommunicationActionKind::Thanks,
            amount: 0.0,
        };
    }

    CommunicationPlan {
        action: CommunicationActionKind::None,
        amount: 0.0,
    }
}

fn reject_coalition_support(
    own_troops: f64,
    own_max_troops: f64,
    growth_rate_before: f64,
    reason: CoalitionSupportReason,
) -> CoalitionGrowthSupportDecision {
    CoalitionGrowthSupportDecision {
        donate: false,
        amount: 0.0,
        purpose: CoalitionSupportPurpose::None,
        own_reserve_after: own_troops / own_max_troops,
        growth_rate_before,
        growth_rate_after: growth_rate_before,
        growth_rate_gain_ratio: 1.0,
        enemy_growth_rate_before: 0.0,
        enemy_growth_rate_after: 0.0,
        enemy_growth_suppression_ratio: 0.0,
        projected_enemy_reserve_after: 1.0,
        reason,
    }
}

pub fn plan_coalition_growth_support(
    input: CoalitionGrowthSupportInput,
) -> CoalitionGrowthSupportDecision {
    let own_max_troops = input.own_max_troops.max(1.0);
    let ally_max_troops = input.ally_max_troops.max(1.0);
    let own_troops = input.own_troops.max(0.0);
    let ally_troops = input.ally_troops.max(0.0);
    let growth_rate_before = projected_troop_growth_rate(
        own_max_troops,
        own_troops,
        input.own_growth_multiplier,
    )
    .max(0.0);

    if !input.ally_is_nation || !input.can_donate {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::IllegalRecipient,
        );
    }
    if input.active_nation_wars > 0 || input.incoming_fronts > 0 {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::ActiveHomeFront,
        );
    }

    let own_reserve_ratio = own_troops / own_max_troops;
    let ally_reserve_ratio = ally_troops / ally_max_troops;
    if own_reserve_ratio < 0.82 || ally_reserve_ratio >= 0.9 {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::DonorOrAllyReserve,
        );
    }

    let safe_reserve_ratio = 0.68_f64.max(clamp(input.reserve_floor, 0.0, 1.0) + 0.16);
    let safe_reserve_troops = own_max_troops * safe_reserve_ratio;
    let available_surplus = (own_troops - safe_reserve_troops).max(0.0);
    let ally_headroom = (ally_max_troops - ally_troops).max(0.0);

    let pressure_eligible = input.shared_enemy_is_nation
        && input.ally_can_pressure_shared_enemy
        && input.ally_committed_troops > 0.0
        && input.shared_enemy_troops > 0.0
        && input.shared_enemy_max_troops > 0.0
        && input.enemy_growth_multiplier.is_some()
        && input.ally_reliability >= 0.5;
    if pressure_eligible {
        let maximum_pressure_amount = (own_troops * 0.12)
            .min(available_surplus * 0.45)
            .min(ally_headroom * 0.2)
            .floor();
        let minimum_useful_amount = (own_max_troops * 0.008).max(maximum_pressure_amount * 0.25);
        let enemy_troops = input.shared_enemy_troops.max(0.0);
        let enemy_max_troops = input.shared_enemy_max_troops.max(1.0);
        let allied_pressure = input.ally_committed_troops.max(0.0);
        let combat_conversion = 0.38;
        let baseline_enemy_after = (enemy_troops - allied_pressure * combat_conversion).max(0.0);
        let enemy_multiplier = input.enemy_growth_multiplier.unwrap_or(1.0);
        let enemy_growth_rate_before = projected_troop_growth_rate(
            enemy_max_troops,
            baseline_enemy_after,
            enemy_multiplier,
        )
        .max(0.0);

        let mut selected: Option<(f64, f64, f64, f64, f64, f64, f64)> = None;
        for fraction in [0.25, 0.5, 0.75, 1.0] {
            let amount = (maximum_pressure_amount * fraction).floor();
            if amount < minimum_useful_amount {
                continue;
            }
            let own_troops_after = own_troops - amount;
            let growth_rate_after = projected_troop_growth_rate(
                own_max_troops,
                own_troops_after,
                input.own_growth_multiplier,
            )
            .max(0.0);
            let projected_enemy_troops =
                (baseline_enemy_after - amount * combat_conversion).max(0.0);
            let enemy_growth_rate_after = projected_troop_growth_rate(
                enemy_max_troops,
                projected_enemy_troops,
                enemy_multiplier,
            )
            .max(0.0);
            let enemy_growth_suppression_ratio = if enemy_growth_rate_before <= 0.0 {
                0.0
            } else {
                (enemy_growth_rate_before - enemy_growth_rate_after) / enemy_growth_rate_before
            };
            let growth_rate_gain_ratio = if growth_rate_before <= 0.0 {
                if growth_rate_after > 0.0 { 10.0 } else { 1.0 }
            } else {
                growth_rate_after / growth_rate_before
            };
            let projected_enemy_reserve_after = projected_enemy_troops / enemy_max_troops;

            if own_troops_after < safe_reserve_troops
                || growth_rate_gain_ratio < 1.01
                || (enemy_growth_suppression_ratio < 0.05
                    && projected_enemy_reserve_after > 0.16)
            {
                continue;
            }

            let candidate = (
                amount,
                own_troops_after,
                growth_rate_after,
                growth_rate_gain_ratio,
                enemy_growth_rate_after,
                enemy_growth_suppression_ratio,
                projected_enemy_reserve_after,
            );
            let replace = match selected {
                None => true,
                Some(best) => {
                    enemy_growth_suppression_ratio > best.5
                        || (enemy_growth_suppression_ratio == best.5 && amount < best.0)
                }
            };
            if replace {
                selected = Some(candidate);
            }
        }

        if let Some((
            amount,
            own_troops_after,
            growth_rate_after,
            growth_rate_gain_ratio,
            enemy_growth_rate_after,
            enemy_growth_suppression_ratio,
            projected_enemy_reserve_after,
        )) = selected
        {
            return CoalitionGrowthSupportDecision {
                donate: true,
                amount,
                purpose: CoalitionSupportPurpose::Pressure,
                own_reserve_after: own_troops_after / own_max_troops,
                growth_rate_before,
                growth_rate_after,
                growth_rate_gain_ratio,
                enemy_growth_rate_before,
                enemy_growth_rate_after,
                enemy_growth_suppression_ratio,
                projected_enemy_reserve_after,
                reason: CoalitionSupportReason::SharedEnemyPressure,
            };
        }
    }

    if !input.ally_has_growth_route {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::NoGrowthRoute,
        );
    }
    if input.ally_reliability < 0.58 {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::LowReliability,
        );
    }
    if ally_reserve_ratio >= 0.82 {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::AllyGrowthHeadroom,
        );
    }

    let amount = (own_troops * 0.16)
        .min(available_surplus * 0.5)
        .min(ally_headroom * 0.25)
        .floor();
    if amount < own_max_troops * 0.01 {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::SurplusTooSmall,
        );
    }

    let own_troops_after = own_troops - amount;
    let growth_rate_after = projected_troop_growth_rate(
        own_max_troops,
        own_troops_after,
        input.own_growth_multiplier,
    )
    .max(0.0);
    let growth_rate_gain_ratio = if growth_rate_before <= 0.0 {
        if growth_rate_after > 0.0 { 10.0 } else { 1.0 }
    } else {
        growth_rate_after / growth_rate_before
    };
    if growth_rate_gain_ratio < 1.02 {
        return reject_coalition_support(
            own_troops,
            own_max_troops,
            growth_rate_before,
            CoalitionSupportReason::NoRegenerationGain,
        );
    }

    CoalitionGrowthSupportDecision {
        donate: true,
        amount,
        purpose: CoalitionSupportPurpose::Growth,
        own_reserve_after: own_troops_after / own_max_troops,
        growth_rate_before,
        growth_rate_after,
        growth_rate_gain_ratio,
        enemy_growth_rate_before: 0.0,
        enemy_growth_rate_after: 0.0,
        enemy_growth_suppression_ratio: 0.0,
        projected_enemy_reserve_after: 1.0,
        reason: CoalitionSupportReason::GrowthInvestment,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cooperation_requires_evidence_before_trust() {
        let fresh = assess_alliance_cooperation(0, 0, 0, 0, 0, 0.1);
        assert!(!fresh.trusted);
        let useful = assess_alliance_cooperation(2, 0, 6, 5, 1, 0.5);
        assert!(useful.trusted);
        assert!(useful.reliability > 0.7);
    }

    #[test]
    fn lifecycle_replaces_a_proven_bad_ally() {
        let plan = plan_alliance_lifecycle(AllianceLifecycleInput {
            is_same_team: false,
            other_is_traitor: false,
            shares_border: false,
            ticks_until_expiry: 100.0,
            betrayal_penalty_ticks: 300.0,
            in_extension_window: true,
            own_reserve_ratio: 0.8,
            other_reserve_ratio: 0.6,
            troop_ratio: 0.5,
            capacity_ratio: 0.5,
            territory_ratio: 0.5,
            alliance_count: 1,
            hostile_nation_borders: 0,
            active_nation_wars: 0,
            incoming_fronts: 0,
            cooperation_reliability: 0.2,
            cooperation_confidence: 0.8,
            should_replace_uncooperative_ally: true,
            replacement_available: true,
            other_players_alive: 5.0,
            forecast_choice: AllianceForecastChoice::Bank,
            forecast_threat: 0.2,
        });
        assert_eq!(plan.action, AllianceLifecycleAction::DoNotRenew);
        assert_eq!(plan.reason, AllianceLifecycleReason::ReplaceUncooperative);
    }

    #[test]
    fn communication_does_not_request_troops_from_a_depleted_ally() {
        let plan = plan_communication(
            0.3, 0.48, 0.0, 1_000_000.0, None, 0, true, 500.0, 0.9, 0.48,
            1_000_000.0, 200_000.0, 0, 0.0, 0.4, 0.8, 0.4, false, 0, 0, 500.0,
            900_000.0, 1_000_000.0, 1_000_000.0, false, false, 500.0, 240.0,
        );
        assert_ne!(plan.action, CommunicationActionKind::RequestTroops);
    }

    #[test]
    fn growth_support_turns_overfull_reserve_into_regeneration() {
        let decision = plan_coalition_growth_support(CoalitionGrowthSupportInput {
            own_troops: 950_000.0,
            own_max_troops: 1_000_000.0,
            reserve_floor: 0.48,
            active_nation_wars: 0,
            incoming_fronts: 0,
            ally_troops: 300_000.0,
            ally_max_troops: 1_000_000.0,
            ally_reliability: 0.9,
            ally_is_nation: true,
            can_donate: true,
            ally_has_growth_route: true,
            ally_committed_troops: 0.0,
            shared_enemy_troops: 0.0,
            shared_enemy_max_troops: 0.0,
            shared_enemy_is_nation: false,
            ally_can_pressure_shared_enemy: false,
            own_growth_multiplier: 1.0,
            enemy_growth_multiplier: None,
        });
        assert!(decision.donate);
        assert_eq!(decision.purpose, CoalitionSupportPurpose::Growth);
        assert!(decision.growth_rate_gain_ratio > 1.02);
    }

    #[test]
    fn pressure_support_can_suppress_shared_enemy_regeneration() {
        let decision = plan_coalition_growth_support(CoalitionGrowthSupportInput {
            own_troops: 980_000.0,
            own_max_troops: 1_000_000.0,
            reserve_floor: 0.48,
            active_nation_wars: 0,
            incoming_fronts: 0,
            ally_troops: 500_000.0,
            ally_max_troops: 1_000_000.0,
            ally_reliability: 0.9,
            ally_is_nation: true,
            can_donate: true,
            ally_has_growth_route: false,
            ally_committed_troops: 600_000.0,
            shared_enemy_troops: 300_000.0,
            shared_enemy_max_troops: 1_000_000.0,
            shared_enemy_is_nation: true,
            ally_can_pressure_shared_enemy: true,
            own_growth_multiplier: 1.0,
            enemy_growth_multiplier: Some(1.0),
        });
        assert!(decision.donate);
        assert_eq!(decision.purpose, CoalitionSupportPurpose::Pressure);
        assert!(decision.enemy_growth_suppression_ratio >= 0.05 || decision.projected_enemy_reserve_after <= 0.16);
    }
}
