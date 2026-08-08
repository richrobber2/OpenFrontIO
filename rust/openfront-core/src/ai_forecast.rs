//! Deterministic opponent forecasting and combat-pressure prediction.
//!
//! Game observation collection remains in TypeScript. This module owns the
//! pure classification, probability, projection, and threat math so the live
//! trainer can share one deterministic implementation with WebAssembly tests.

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpponentChoice {
    Attack = 0,
    Defend = 1,
    Expand = 2,
    Bank = 3,
    Economy = 4,
    Naval = 5,
}

impl OpponentChoice {
    pub const ALL: [Self; 6] = [
        Self::Attack,
        Self::Defend,
        Self::Expand,
        Self::Bank,
        Self::Economy,
        Self::Naval,
    ];

    pub const fn index(self) -> usize {
        self as usize
    }

    pub const fn from_code(code: u32) -> Self {
        match code {
            0 => Self::Attack,
            1 => Self::Defend,
            2 => Self::Expand,
            3 => Self::Bank,
            4 => Self::Economy,
            5 => Self::Naval,
            _ => Self::Bank,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OpponentObservation {
    pub tick: f64,
    pub troops: f64,
    pub max_troops: f64,
    pub tiles: f64,
    pub gold: f64,
    pub incoming_attacks: f64,
    pub incoming_troops: f64,
    pub outgoing_attacks: f64,
    pub outgoing_troops: f64,
    pub cities: f64,
    pub factories: f64,
    pub ports: f64,
    pub silos: f64,
    pub warships: f64,
    pub allied: bool,
    pub shares_border: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OpponentProjection {
    pub tick: f64,
    pub troops: f64,
    pub tiles: f64,
    pub reserve_ratio: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OpponentForecast {
    pub observed_choice: OpponentChoice,
    pub predicted_choice: OpponentChoice,
    pub probabilities: [f64; 6],
    pub confidence: f64,
    pub threat: f64,
    pub near: OpponentProjection,
    pub far: OpponentProjection,
}

fn previous_delta(current: f64, previous: Option<f64>) -> f64 {
    previous.map_or(0.0, |value| current - value)
}

pub fn infer_opponent_choice(
    current: &OpponentObservation,
    previous: Option<&OpponentObservation>,
) -> OpponentChoice {
    let tile_delta = previous_delta(current.tiles, previous.map(|value| value.tiles));
    let outgoing_delta = previous_delta(
        current.outgoing_troops,
        previous.map(|value| value.outgoing_troops),
    );
    let structure_delta = previous_delta(current.cities, previous.map(|value| value.cities))
        + previous_delta(
            current.factories,
            previous.map(|value| value.factories),
        )
        + previous_delta(current.ports, previous.map(|value| value.ports))
        + previous_delta(current.silos, previous.map(|value| value.silos));
    let naval_delta = previous_delta(current.warships, previous.map(|value| value.warships))
        + previous_delta(current.ports, previous.map(|value| value.ports));

    if current.incoming_attacks > 0.0
        && (tile_delta < 0.0 || current.incoming_troops > current.outgoing_troops)
    {
        return OpponentChoice::Defend;
    }
    if outgoing_delta > 0.0
        || (current.outgoing_attacks > 0.0 && current.outgoing_troops > 0.0)
    {
        return OpponentChoice::Attack;
    }
    if naval_delta > 0.0 {
        return OpponentChoice::Naval;
    }
    if structure_delta > 0.0 {
        return OpponentChoice::Economy;
    }
    if tile_delta > 0.0 {
        return OpponentChoice::Expand;
    }
    OpponentChoice::Bank
}

fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

fn projected_state(
    current: &OpponentObservation,
    predicted_choice: OpponentChoice,
    troop_delta: f64,
    tile_delta: f64,
    horizon: f64,
) -> OpponentProjection {
    let action_troop_factor = match predicted_choice {
        OpponentChoice::Attack => -0.0008,
        OpponentChoice::Defend => -0.00025,
        OpponentChoice::Bank => 0.0007,
        _ => 0.00025,
    };
    let action_tile_rate = if matches!(
        predicted_choice,
        OpponentChoice::Expand | OpponentChoice::Attack
    ) {
        tile_delta.max(0.02)
    } else {
        (tile_delta * 0.35).max(0.0)
    };
    let projected_troops = clamp(
        current.troops
            + (troop_delta + current.max_troops * action_troop_factor) * horizon,
        0.0,
        current.max_troops,
    );
    let projected_tiles = (current.tiles + action_tile_rate * horizon).round().max(0.0);
    OpponentProjection {
        tick: current.tick + horizon,
        troops: projected_troops,
        tiles: projected_tiles,
        reserve_ratio: projected_troops / current.max_troops.max(1.0),
    }
}

pub fn forecast_opponent(
    current: &OpponentObservation,
    previous: Option<&OpponentObservation>,
    previous_forecast: Option<(OpponentChoice, f64)>,
    own_troops: f64,
    own_max_troops: f64,
    own_tiles: f64,
) -> OpponentForecast {
    let elapsed_ticks = (current.tick - previous.map_or(current.tick, |value| value.tick)).max(1.0);
    let troop_delta =
        previous_delta(current.troops, previous.map(|value| value.troops)) / elapsed_ticks;
    let tile_delta =
        previous_delta(current.tiles, previous.map(|value| value.tiles)) / elapsed_ticks;
    let gold_delta =
        previous_delta(current.gold, previous.map(|value| value.gold)) / elapsed_ticks;
    let outgoing_delta = previous_delta(
        current.outgoing_troops,
        previous.map(|value| value.outgoing_troops),
    ) / current.max_troops.max(1.0);
    let structure_delta = previous_delta(current.cities, previous.map(|value| value.cities))
        + previous_delta(
            current.factories,
            previous.map(|value| value.factories),
        )
        + previous_delta(current.ports, previous.map(|value| value.ports))
        + previous_delta(current.silos, previous.map(|value| value.silos));
    let naval_delta = previous_delta(current.warships, previous.map(|value| value.warships))
        + previous_delta(current.ports, previous.map(|value| value.ports));
    let reserve_ratio = current.troops / current.max_troops.max(1.0);
    let observed_choice = infer_opponent_choice(current, previous);

    let mut scores = [
        0.2 + current.outgoing_attacks * 1.25
            + (current.outgoing_troops / current.max_troops.max(1.0)) * 2.4
            + outgoing_delta.max(0.0) * 4.0
            + if reserve_ratio > 0.62 { 0.45 } else { 0.0 },
        0.15 + current.incoming_attacks * 1.45
            + (current.incoming_troops / current.max_troops.max(1.0)) * 2.8
            + if tile_delta < 0.0 {
                (-tile_delta * 0.08).min(2.0)
            } else {
                0.0
            },
        0.2 + (tile_delta.max(0.0) * 0.12).min(3.0)
            + if current.tiles < own_tiles * 0.45 {
                0.5
            } else {
                0.0
            }
            + if current.outgoing_attacks == 0.0 && reserve_ratio > 0.45 {
                0.25
            } else {
                0.0
            },
        0.25 + if current.incoming_attacks + current.outgoing_attacks == 0.0 {
            0.65
        } else {
            0.0
        } + if troop_delta > 0.0 {
            ((troop_delta / current.max_troops.max(1.0)) * 400.0).min(1.5)
        } else {
            0.0
        } + if reserve_ratio < 0.45 { 0.55 } else { 0.0 },
        0.15 + structure_delta.max(0.0) * 1.4
            + if gold_delta < 0.0 { 0.35 } else { 0.0 }
            + if reserve_ratio > 0.5 && current.incoming_attacks == 0.0 {
                0.35
            } else {
                0.0
            },
        0.1 + naval_delta.max(0.0) * 1.5
            + current.warships * 0.08
            + if current.ports > 0.0 { 0.2 } else { 0.0 },
    ];

    scores[observed_choice.index()] += 1.1;
    if let Some((choice, confidence)) = previous_forecast {
        scores[choice.index()] += 0.35 + confidence * 0.45;
    }

    let total_score: f64 = scores.iter().map(|score| score.max(0.001)).sum();
    let probabilities = scores.map(|score| score.max(0.001) / total_score);

    let mut best = 0usize;
    let mut second = 1usize;
    if probabilities[second] > probabilities[best] {
        std::mem::swap(&mut best, &mut second);
    }
    for index in 2..probabilities.len() {
        if probabilities[index] > probabilities[best] {
            second = best;
            best = index;
        } else if probabilities[index] > probabilities[second] {
            second = index;
        }
    }
    let predicted_choice = OpponentChoice::ALL[best];
    let confidence = clamp(probabilities[best] - probabilities[second], 0.0, 1.0);

    let force_pressure =
        (current.troops + current.outgoing_troops) / own_troops.max(1.0);
    let capacity_pressure = current.max_troops / own_max_troops.max(1.0);
    let territory_pressure = current.tiles / own_tiles.max(1.0);
    let strategic_pressure =
        current.silos * 0.12 + current.warships * 0.025 + current.factories * 0.02;
    let relationship_factor = if current.allied { 0.55 } else { 1.0 };
    let proximity_factor = if current.shares_border { 1.25 } else { 0.8 };
    let choice_factor = match predicted_choice {
        OpponentChoice::Attack => 1.25,
        OpponentChoice::Economy | OpponentChoice::Expand => 1.1,
        _ => 1.0,
    };
    let threat = (force_pressure * 0.4
        + capacity_pressure * 0.25
        + territory_pressure * 0.2
        + strategic_pressure)
        * relationship_factor
        * proximity_factor
        * choice_factor;

    OpponentForecast {
        observed_choice,
        predicted_choice,
        probabilities,
        confidence,
        threat,
        near: projected_state(current, predicted_choice, troop_delta, tile_delta, 120.0),
        far: projected_state(current, predicted_choice, troop_delta, tile_delta, 600.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation() -> OpponentObservation {
        OpponentObservation {
            tick: 100.0,
            troops: 700_000.0,
            max_troops: 1_000_000.0,
            tiles: 5_000.0,
            gold: 2_000_000.0,
            incoming_attacks: 0.0,
            incoming_troops: 0.0,
            outgoing_attacks: 0.0,
            outgoing_troops: 0.0,
            cities: 3.0,
            factories: 1.0,
            ports: 1.0,
            silos: 0.0,
            warships: 1.0,
            allied: false,
            shares_border: true,
        }
    }

    #[test]
    fn infers_defense_before_attack_when_under_pressure() {
        let previous = observation();
        let mut current = previous;
        current.tick = 105.0;
        current.tiles = 4_980.0;
        current.incoming_attacks = 1.0;
        current.incoming_troops = 300_000.0;
        current.outgoing_attacks = 1.0;
        current.outgoing_troops = 100_000.0;
        assert_eq!(
            infer_opponent_choice(&current, Some(&previous)),
            OpponentChoice::Defend
        );
    }

    #[test]
    fn forecast_probabilities_are_normalized_and_project_forward() {
        let previous = observation();
        let mut current = previous;
        current.tick = 105.0;
        current.tiles = 5_040.0;
        current.troops = 730_000.0;
        current.outgoing_attacks = 1.0;
        current.outgoing_troops = 180_000.0;
        let forecast = forecast_opponent(
            &current,
            Some(&previous),
            Some((OpponentChoice::Attack, 0.4)),
            800_000.0,
            1_100_000.0,
            5_500.0,
        );
        assert_eq!(forecast.observed_choice, OpponentChoice::Attack);
        assert!((forecast.probabilities.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        assert_eq!(forecast.near.tick, 225.0);
        assert_eq!(forecast.far.tick, 705.0);
        assert!(forecast.threat > 0.0);
    }

    #[test]
    fn alliance_relationship_reduces_projected_threat() {
        let hostile = observation();
        let mut allied = hostile;
        allied.allied = true;
        let hostile_forecast = forecast_opponent(
            &hostile,
            None,
            None,
            700_000.0,
            1_000_000.0,
            5_000.0,
        );
        let allied_forecast = forecast_opponent(
            &allied,
            None,
            None,
            700_000.0,
            1_000_000.0,
            5_000.0,
        );
        assert!(allied_forecast.threat < hostile_forecast.threat);
    }
}
