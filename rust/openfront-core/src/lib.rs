//! Deterministic simulation primitives shared by future OpenFront Rust ports.
//!
//! Browser, rendering, networking, and JavaScript bindings deliberately stay
//! outside this crate so the simulation can be tested without a runtime.

pub mod abstract_graph;
pub mod abstract_graph_builder;
pub mod ai_alliance;
pub mod ai_economy;
pub mod ai_forecast;
pub mod ai_learning;
pub mod ai_ports;
pub mod ai_purchase_queue;
pub mod ai_strategy;
pub mod ai_tactics;
pub mod air_path;
pub mod bfs_grid;
pub mod connected_components;
pub mod defense_index;
pub mod geometry;
pub mod graphics;
pub mod hierarchical_water;
pub mod map;
pub mod nuke_strip;
pub mod nuke_trajectory;
pub mod rail_path;
pub mod random;
pub mod spiral_trail;
pub mod structure_render;
pub mod territory;
pub mod territory_render;
pub mod tile;
pub mod traversal;
pub mod unit_classification;
pub mod water_bounded;
pub mod water_path;

pub use abstract_graph::{AbstractEdge, AbstractGraph, AbstractGraphAStar, AbstractNode, Cluster};
pub use abstract_graph_builder::{AbstractGraphBuilder, DEFAULT_CLUSTER_SIZE};
pub use ai_alliance::{
    alliance_response_window_ticks, assess_alliance_cooperation, choose_aid_request,
    plan_alliance_lifecycle, plan_coalition_growth_support, plan_communication,
    projected_troop_growth_rate, should_coordinate_attack, should_donate_gold,
    should_donate_troops, AidRequestKind, AllianceCooperationAssessment, AllianceCooperationReason,
    AllianceForecastChoice, AllianceLifecycleAction, AllianceLifecycleInput, AllianceLifecyclePlan,
    AllianceLifecycleReason, CoalitionGrowthSupportDecision, CoalitionGrowthSupportInput,
    CoalitionSupportPurpose, CoalitionSupportReason, CommunicationActionKind, CommunicationPlan,
};
pub use ai_economy::{
    capacity_escape_city_budget, estimate_trade_route_gold, plan_economic_systems,
    rail_city_growth_score, score_city_stack_placement, score_factory_placement,
    should_fund_first_pressure_factory, CapacityEscapeCityBudget, CityStackPlacementScore,
    EconomicSystemAction, EconomicSystemContext, EconomicSystemPlan, FactoryPlacementScore,
};
pub use ai_forecast::{
    forecast_opponent, infer_opponent_choice, OpponentChoice, OpponentForecast,
    OpponentObservation, OpponentProjection,
};
pub use ai_learning::{
    apply_action_outcome_learning, classify_loss_cause, evaluate_seed_cohort,
    human_troop_regeneration, land_troop_capacity, normalize_action_reward, predict_future_outcome,
    score_counterfactual_action_outcome, score_delayed_action_outcome, score_mutation_outcome,
    ActionOutcome, ActionOutcomeGenes, ActionRewardBaseline, FuturePrediction, LossCause,
    NormalizedActionReward, PredictionAction, SeedCohortResult,
};
pub use ai_ports::{
    plan_adaptive_port_actions, score_adaptive_trade_port_option, AdaptivePortAction,
    AdaptivePortContext, AdaptivePortPlan, AdaptiveTradePortNormalization, AdaptiveTradePortOption,
    AdaptiveTradePortScore, AdaptiveTradePortThresholds,
};
pub use ai_purchase_queue::{select_purchase_queue, PurchaseCandidate, PurchaseQueuePlan};
pub use ai_strategy::{
    evaluate_coalition_target, model_opponent, plan_strategic_action, CoalitionHelper,
    CoalitionTargetEvaluation, OpponentModel, PredictedChoice, StrategicAction, StrategicPlan,
    StrategicPlanInput,
};
pub use ai_tactics::{
    assess_attack_capacity, desired_banked_troops, desired_capacity_escape_city_count,
    desired_defensive_city_count, desired_factory_count, desired_fleet_troop_bank,
    desired_warship_count, estimate_land_attack_ticks, is_strategically_trapped,
    minimum_defense_post_depth, nation_front_policy, nation_land_front_allowed,
    plan_capacity_escape_raid, should_accept_alliance, should_build_capacity_city,
    should_risk_denial_raid, should_trade_land_for_time, tribe_attack_commitment_multiplier,
    AttackCapacity, CapacityEscapeRaidPlan, NationFrontPolicy,
};
pub use air_path::{air_path, AirPathError};
pub use bfs_grid::{BfsGrid, BfsVisit};
pub use connected_components::{ConnectedWaterComponents, LAND_COMPONENT_MARKER};
pub use defense_index::{
    Defense, DefenseIndex, DefensePathAssessment, DefensePathPoint, DefensePoint,
};
pub use geometry::{Coord, GridError, GridGeometry, NeighborRefs, TileRef};
pub use graphics::{
    build_terrain_delta_records_in_place, build_terrain_rgba, build_terrain_rgba_in_place,
    encode_terrain_rgba, TerrainGraphicsError, TerrainPalette,
};
pub use hierarchical_water::HierarchicalWaterPathFinder;
pub use map::{GameMapError, GameMapStore};
pub use nuke_strip::{
    build_nuke_strip_vertices, write_nuke_strip_vertices, NukeStripError,
    NUKE_STRIP_FLOATS_PER_PAIR,
};
pub use nuke_trajectory::{
    build_nuke_trajectory, compute_nuke_control_points, compute_trajectory_thresholds, sam_range,
    NukeControlPoints, NukeTrajectory, SamInfo, TrajectoryThresholds,
};
pub use rail_path::{rail_path, RailPathFinder};
pub use random::PseudoRandom;
pub use spiral_trail::{
    write_spiral_segment_samples, SpiralTrailError, SPIRAL_SAMPLES_PER_TILE, SPIRAL_SAMPLE_FLOATS,
};
pub use structure_render::{StructureRenderState, STRUCTURE_FLOATS_PER_INSTANCE};
pub use territory::OwnerTerritoryAnalysis;
pub use territory_render::{
    TerritoryRenderError, TerritoryRenderQueue, TERRITORY_BORDER_CHANGE_WORDS,
    TERRITORY_TILE_PATCH_FLOATS,
};
pub use tile::{
    apply_packed_update, PackedTile, Terrain, TerrainType, TileState, TileStateError,
    TileTransition, DEFENSE_BONUS_MASK, FALLOUT_MASK, IMPASSABLE_MAGNITUDE, OWNER_ID_MASK,
    TERRAIN_LAND_MASK, TERRAIN_MAGNITUDE_MASK, TERRAIN_OCEAN_MASK, TERRAIN_SHORELINE_MASK,
};
pub use traversal::NeighborRefs8;
pub use unit_classification::{
    classify_unit_kind, UnitKind, UNIT_CLASS_ATTACK_RING, UNIT_CLASS_LIGHT, UNIT_CLASS_MOBILE,
    UNIT_CLASS_NUKE_ACTIVE, UNIT_CLASS_NUKE_TELEGRAPH, UNIT_CLASS_STRUCTURE, UNIT_CLASS_TRAIL,
};
pub use water_bounded::{BoundedWaterPathFinder, SearchBounds};
pub use water_path::WaterPathFinder;
