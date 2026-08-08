use openfront_core::{
    forecast_opponent, infer_opponent_choice, OpponentChoice, OpponentForecast, OpponentObservation,
};

#[allow(clippy::too_many_arguments)]
fn make_observation(
    tick: f64,
    troops: f64,
    max_troops: f64,
    tiles: f64,
    gold: f64,
    incoming_attacks: f64,
    incoming_troops: f64,
    outgoing_attacks: f64,
    outgoing_troops: f64,
    cities: f64,
    factories: f64,
    ports: f64,
    silos: f64,
    warships: f64,
    allied: u32,
    shares_border: u32,
) -> OpponentObservation {
    OpponentObservation {
        tick,
        troops,
        max_troops,
        tiles,
        gold,
        incoming_attacks,
        incoming_troops,
        outgoing_attacks,
        outgoing_troops,
        cities,
        factories,
        ports,
        silos,
        warships,
        allied: allied != 0,
        shares_border: shares_border != 0,
    }
}

fn write_forecast_result(forecast: OpponentForecast) {
    set_result([
        forecast.observed_choice as u32,
        forecast.predicted_choice as u32,
    ]);
    set_f64_result([
        forecast.probabilities[0],
        forecast.probabilities[1],
        forecast.probabilities[2],
        forecast.probabilities[3],
        forecast.probabilities[4],
        forecast.probabilities[5],
        forecast.confidence,
        forecast.threat,
        forecast.near.tick,
        forecast.near.troops,
        forecast.near.tiles,
        forecast.near.reserve_ratio,
        forecast.far.tick,
        forecast.far.troops,
        forecast.far.tiles,
        forecast.far.reserve_ratio,
    ]);
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_infer_opponent_choice(
    current_tiles: f64,
    current_incoming_attacks: f64,
    current_incoming_troops: f64,
    current_outgoing_attacks: f64,
    current_outgoing_troops: f64,
    current_cities: f64,
    current_factories: f64,
    current_ports: f64,
    current_silos: f64,
    current_warships: f64,
    has_previous: u32,
    previous_tiles: f64,
    previous_outgoing_troops: f64,
    previous_cities: f64,
    previous_factories: f64,
    previous_ports: f64,
    previous_silos: f64,
    previous_warships: f64,
) -> u32 {
    begin_call();
    let current = make_observation(
        0.0,
        0.0,
        1.0,
        current_tiles,
        0.0,
        current_incoming_attacks,
        current_incoming_troops,
        current_outgoing_attacks,
        current_outgoing_troops,
        current_cities,
        current_factories,
        current_ports,
        current_silos,
        current_warships,
        0,
        0,
    );
    let previous = (has_previous != 0).then(|| {
        make_observation(
            0.0,
            0.0,
            1.0,
            previous_tiles,
            0.0,
            0.0,
            0.0,
            0.0,
            previous_outgoing_troops,
            previous_cities,
            previous_factories,
            previous_ports,
            previous_silos,
            previous_warships,
            0,
            0,
        )
    });
    infer_opponent_choice(&current, previous.as_ref()) as u32
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn openfront_ai_forecast_opponent(
    current_tick: f64,
    current_troops: f64,
    current_max_troops: f64,
    current_tiles: f64,
    current_gold: f64,
    current_incoming_attacks: f64,
    current_incoming_troops: f64,
    current_outgoing_attacks: f64,
    current_outgoing_troops: f64,
    current_cities: f64,
    current_factories: f64,
    current_ports: f64,
    current_silos: f64,
    current_warships: f64,
    current_allied: u32,
    current_shares_border: u32,
    has_previous: u32,
    previous_tick: f64,
    previous_troops: f64,
    previous_max_troops: f64,
    previous_tiles: f64,
    previous_gold: f64,
    previous_incoming_attacks: f64,
    previous_incoming_troops: f64,
    previous_outgoing_attacks: f64,
    previous_outgoing_troops: f64,
    previous_cities: f64,
    previous_factories: f64,
    previous_ports: f64,
    previous_silos: f64,
    previous_warships: f64,
    has_previous_forecast: u32,
    previous_forecast_choice: u32,
    previous_forecast_confidence: f64,
    own_troops: f64,
    own_max_troops: f64,
    own_tiles: f64,
) -> u32 {
    begin_call();
    let current = make_observation(
        current_tick,
        current_troops,
        current_max_troops,
        current_tiles,
        current_gold,
        current_incoming_attacks,
        current_incoming_troops,
        current_outgoing_attacks,
        current_outgoing_troops,
        current_cities,
        current_factories,
        current_ports,
        current_silos,
        current_warships,
        current_allied,
        current_shares_border,
    );
    let previous = (has_previous != 0).then(|| {
        make_observation(
            previous_tick,
            previous_troops,
            previous_max_troops,
            previous_tiles,
            previous_gold,
            previous_incoming_attacks,
            previous_incoming_troops,
            previous_outgoing_attacks,
            previous_outgoing_troops,
            previous_cities,
            previous_factories,
            previous_ports,
            previous_silos,
            previous_warships,
            0,
            0,
        )
    });
    let previous_forecast = (has_previous_forecast != 0).then(|| {
        (
            OpponentChoice::from_code(previous_forecast_choice),
            previous_forecast_confidence,
        )
    });
    let forecast = forecast_opponent(
        &current,
        previous.as_ref(),
        previous_forecast,
        own_troops,
        own_max_troops,
        own_tiles,
    );
    write_forecast_result(forecast);
    1
}
