const PARABOLA_MIN_HEIGHT: f64 = 50.0;
const TARGETABLE_RANGE: f64 = 150.0;
const TARGETABLE_RANGE_SQ: f64 = TARGETABLE_RANGE * TARGETABLE_RANGE;
const THRESHOLD_SAMPLES: u32 = 64;
const CROSSING_REFINEMENT_STEPS: usize = 10;

const MAX_SAM_RANGE: f64 = 150.0;
const SAM_RANGE_DIVISOR: f64 = 480.0;
const SAM_RANGE_OFFSET: f64 = 5.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SamInfo {
    pub x: f64,
    pub y: f64,
    pub range_sq: f64,
}

impl SamInfo {
    pub const fn new(x: f64, y: f64, range_sq: f64) -> Self {
        Self { x, y, range_sq }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NukeControlPoints {
    pub p0x: f64,
    pub p0y: f64,
    pub p1x: f64,
    pub p1y: f64,
    pub p2x: f64,
    pub p2y: f64,
    pub p3x: f64,
    pub p3y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrajectoryThresholds {
    pub t_untargetable_start: f64,
    pub t_untargetable_end: f64,
    pub t_sam_intercept: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NukeTrajectory {
    pub control_points: NukeControlPoints,
    pub thresholds: TrajectoryThresholds,
}

pub fn sam_range(level: f64) -> f64 {
    MAX_SAM_RANGE - SAM_RANGE_DIVISOR / (level + SAM_RANGE_OFFSET)
}

pub fn compute_nuke_control_points(
    src_x: f64,
    src_y: f64,
    dst_x: f64,
    dst_y: f64,
    map_height: f64,
    direction_up: bool,
) -> NukeControlPoints {
    let dx = dst_x - src_x;
    let dy = dst_y - src_y;
    let distance = (dx * dx + dy * dy).sqrt();
    let max_height = if distance / 3.0 > PARABOLA_MIN_HEIGHT {
        distance / 3.0
    } else {
        PARABOLA_MIN_HEIGHT
    };
    let height_multiplier = if direction_up { -1.0 } else { 1.0 };
    let max_y = map_height - 1.0;

    NukeControlPoints {
        p0x: src_x,
        p0y: src_y,
        p1x: src_x + dx / 4.0,
        p1y: clamp(
            src_y + dy / 4.0 + height_multiplier * max_height,
            0.0,
            max_y,
        ),
        p2x: src_x + dx * 3.0 / 4.0,
        p2y: clamp(
            src_y + dy * 3.0 / 4.0 + height_multiplier * max_height,
            0.0,
            max_y,
        ),
        p3x: dst_x,
        p3y: dst_y,
    }
}

pub fn compute_trajectory_thresholds(
    control_points: NukeControlPoints,
    src_x: f64,
    src_y: f64,
    dst_x: f64,
    dst_y: f64,
    sams: &[SamInfo],
) -> TrajectoryThresholds {
    let mut t_untargetable_start = -1.0;
    let mut t_untargetable_end = -1.0;
    let mut t_sam_intercept = 1.0;
    let dt = 1.0 / f64::from(THRESHOLD_SAMPLES);

    for sample in 1..=THRESHOLD_SAMPLES {
        let t = f64::from(sample) * dt;
        let (x, y) = bezier_point(control_points, t);

        if t_untargetable_start < 0.0 {
            if distance_squared(x, y, src_x, src_y) > TARGETABLE_RANGE_SQ {
                if distance_squared(x, y, dst_x, dst_y) < TARGETABLE_RANGE_SQ {
                    break;
                }
                t_untargetable_start = refine_crossing(
                    control_points,
                    src_x,
                    src_y,
                    TARGETABLE_RANGE_SQ,
                    t - dt,
                    t,
                    true,
                );
            }
        } else if distance_squared(x, y, dst_x, dst_y) < TARGETABLE_RANGE_SQ {
            t_untargetable_end = refine_crossing(
                control_points,
                dst_x,
                dst_y,
                TARGETABLE_RANGE_SQ,
                t - dt,
                t,
                false,
            );
            break;
        }
    }

    if !sams.is_empty() {
        'samples: for sample in 1..=THRESHOLD_SAMPLES {
            let t = f64::from(sample) * dt;
            if t_untargetable_start >= 0.0
                && t >= t_untargetable_start
                && t <= t_untargetable_end
            {
                continue;
            }

            let (x, y) = bezier_point(control_points, t);
            for sam in sams {
                if distance_squared(x, y, sam.x, sam.y) <= sam.range_sq {
                    t_sam_intercept = refine_crossing(
                        control_points,
                        sam.x,
                        sam.y,
                        sam.range_sq,
                        t - dt,
                        t,
                        false,
                    );
                    break 'samples;
                }
            }
        }
    }

    TrajectoryThresholds {
        t_untargetable_start,
        t_untargetable_end,
        t_sam_intercept,
    }
}

pub fn build_nuke_trajectory(
    src_x: f64,
    src_y: f64,
    dst_x: f64,
    dst_y: f64,
    map_height: f64,
    direction_up: bool,
    sams: &[SamInfo],
) -> NukeTrajectory {
    let control_points =
        compute_nuke_control_points(src_x, src_y, dst_x, dst_y, map_height, direction_up);
    let thresholds =
        compute_trajectory_thresholds(control_points, src_x, src_y, dst_x, dst_y, sams);
    NukeTrajectory {
        control_points,
        thresholds,
    }
}

fn bezier_point(control_points: NukeControlPoints, t: f64) -> (f64, f64) {
    (
        bezier(
            t,
            control_points.p0x,
            control_points.p1x,
            control_points.p2x,
            control_points.p3x,
        ),
        bezier(
            t,
            control_points.p0y,
            control_points.p1y,
            control_points.p2y,
            control_points.p3y,
        ),
    )
}

fn bezier(t: f64, p0: f64, p1: f64, p2: f64, p3: f64) -> f64 {
    let inverse_t = 1.0 - t;
    inverse_t * inverse_t * inverse_t * p0
        + 3.0 * inverse_t * inverse_t * t * p1
        + 3.0 * inverse_t * t * t * p2
        + t * t * t * p3
}

fn refine_crossing(
    control_points: NukeControlPoints,
    center_x: f64,
    center_y: f64,
    range_sq: f64,
    mut t_lo: f64,
    mut t_hi: f64,
    exiting_range: bool,
) -> f64 {
    for _ in 0..CROSSING_REFINEMENT_STEPS {
        let t_mid = (t_lo + t_hi) * 0.5;
        let (x, y) = bezier_point(control_points, t_mid);
        let inside = distance_squared(x, y, center_x, center_y) <= range_sq;
        if if exiting_range { inside } else { !inside } {
            t_lo = t_mid;
        } else {
            t_hi = t_mid;
        }
    }
    (t_lo + t_hi) * 0.5
}

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value < low {
        low
    } else if value > high {
        high
    } else {
        value
    }
}

fn distance_squared(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    dx * dx + dy * dy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sam_range_matches_upstream_formula() {
        assert_eq!(sam_range(0.0), 54.0);
        assert_eq!(sam_range(1.0), 70.0);
        assert_eq!(sam_range(5.0), 102.0);
        assert!((sam_range(2.5) - 86.0).abs() < f64::EPSILON);
    }

    #[test]
    fn control_points_match_parabola_shape_and_direction() {
        let up = compute_nuke_control_points(10.0, 100.0, 310.0, 100.0, 500.0, true);
        assert_eq!(up.p0x, 10.0);
        assert_eq!(up.p1x, 85.0);
        assert_eq!(up.p1y, 0.0);
        assert_eq!(up.p2x, 235.0);
        assert_eq!(up.p2y, 0.0);
        assert_eq!(up.p3x, 310.0);

        let down = compute_nuke_control_points(10.0, 100.0, 310.0, 100.0, 500.0, false);
        assert_eq!(down.p1y, 200.0);
        assert_eq!(down.p2y, 200.0);
    }

    #[test]
    fn control_points_use_minimum_height_for_short_routes() {
        let points = compute_nuke_control_points(10.0, 100.0, 40.0, 100.0, 500.0, false);
        assert_eq!(points.p1y, 150.0);
        assert_eq!(points.p2y, 150.0);
    }

    #[test]
    fn separated_endpoints_create_untargetable_middle_segment() {
        let points = compute_nuke_control_points(0.0, 250.0, 600.0, 250.0, 800.0, false);
        let thresholds = compute_trajectory_thresholds(points, 0.0, 250.0, 600.0, 250.0, &[]);
        assert!(thresholds.t_untargetable_start > 0.0);
        assert!(thresholds.t_untargetable_end > thresholds.t_untargetable_start);
        assert_eq!(thresholds.t_sam_intercept, 1.0);
    }

    #[test]
    fn overlapping_targetable_ranges_have_no_untargetable_segment() {
        let points = compute_nuke_control_points(0.0, 100.0, 200.0, 100.0, 500.0, false);
        let thresholds = compute_trajectory_thresholds(points, 0.0, 100.0, 200.0, 100.0, &[]);
        assert_eq!(thresholds.t_untargetable_start, -1.0);
        assert_eq!(thresholds.t_untargetable_end, -1.0);
    }

    #[test]
    fn sam_intercept_is_detected_in_targetable_segment() {
        let points = compute_nuke_control_points(0.0, 250.0, 600.0, 250.0, 800.0, false);
        let sam = SamInfo::new(60.0, 330.0, 80.0 * 80.0);
        let thresholds =
            compute_trajectory_thresholds(points, 0.0, 250.0, 600.0, 250.0, &[sam]);
        assert!(thresholds.t_sam_intercept > 0.0);
        assert!(thresholds.t_sam_intercept < thresholds.t_untargetable_start);
    }
}
