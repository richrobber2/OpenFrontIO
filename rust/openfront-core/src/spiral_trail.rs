pub const SPIRAL_SAMPLE_FLOATS: usize = 5;
pub const SPIRAL_SAMPLES_PER_TILE: f64 = 2.0;
const DIRECTION_EPSILON: f64 = 1e-6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpiralTrailError {
    InvalidSegmentLength,
    SizeOverflow,
}

/// Append renderer-facing centerline samples for one moving spiral-nuke segment.
///
/// Each output sample is `[cx, cy, px, py, distance]`, where `(px, py)` is the
/// smoothed perpendicular used by the ribbon shader and `distance` is the
/// cumulative centerline distance from the start of the ribbon.
///
/// `segment_length` is supplied by the JavaScript owner so the Rust sampling
/// path does not perturb the long-lived `headDist` value through a different
/// host `hypot` implementation.
pub fn write_spiral_segment_samples(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    segment_length: f64,
    previous_dir_x: f64,
    previous_dir_y: f64,
    has_previous_dir: bool,
    include_start: bool,
    head_distance: f64,
    output: &mut Vec<f32>,
) -> Result<usize, SpiralTrailError> {
    if !segment_length.is_finite() || segment_length <= 0.0 {
        return Err(SpiralTrailError::InvalidSegmentLength);
    }

    let dx = x1 - x0;
    let dy = y1 - y0;
    let ndx = dx / segment_length;
    let ndy = dy / segment_length;
    let from_dir_x = if has_previous_dir {
        previous_dir_x
    } else {
        ndx
    };
    let from_dir_y = if has_previous_dir {
        previous_dir_y
    } else {
        ndy
    };

    let steps_f64 = (segment_length * SPIRAL_SAMPLES_PER_TILE).ceil();
    if !steps_f64.is_finite() || steps_f64 < 1.0 || steps_f64 > usize::MAX as f64 {
        return Err(SpiralTrailError::SizeOverflow);
    }
    let steps = steps_f64 as usize;
    let sample_count = steps
        .checked_add(usize::from(include_start))
        .ok_or(SpiralTrailError::SizeOverflow)?;
    let float_count = sample_count
        .checked_mul(SPIRAL_SAMPLE_FLOATS)
        .ok_or(SpiralTrailError::SizeOverflow)?;

    output.clear();
    output.resize(float_count, 0.0);
    let mut write_index = 0;

    if include_start {
        let (dir_x, dir_y) = blended_direction(
            from_dir_x,
            from_dir_y,
            ndx,
            ndy,
            0.0,
        );
        write_sample(output, &mut write_index, x0, y0, -dir_y, dir_x, 0.0);
    }

    let step_count = steps as f64;
    for step in 1..=steps {
        let fraction = step as f64 / step_count;
        let (dir_x, dir_y) = blended_direction(
            from_dir_x,
            from_dir_y,
            ndx,
            ndy,
            fraction,
        );
        write_sample(
            output,
            &mut write_index,
            x0 + dx * fraction,
            y0 + dy * fraction,
            -dir_y,
            dir_x,
            head_distance + segment_length * fraction,
        );
    }

    debug_assert_eq!(write_index, float_count);
    Ok(sample_count)
}

fn blended_direction(
    from_dir_x: f64,
    from_dir_y: f64,
    target_dir_x: f64,
    target_dir_y: f64,
    fraction: f64,
) -> (f64, f64) {
    let blend_x = from_dir_x + (target_dir_x - from_dir_x) * fraction;
    let blend_y = from_dir_y + (target_dir_y - from_dir_y) * fraction;
    let length = blend_x.hypot(blend_y);
    if length < DIRECTION_EPSILON {
        return (target_dir_x, target_dir_y);
    }
    (blend_x / length, blend_y / length)
}

fn write_sample(
    output: &mut [f32],
    write_index: &mut usize,
    center_x: f64,
    center_y: f64,
    perpendicular_x: f64,
    perpendicular_y: f64,
    distance: f64,
) {
    let offset = *write_index;
    output[offset] = center_x as f32;
    output[offset + 1] = center_y as f32;
    output[offset + 2] = perpendicular_x as f32;
    output[offset + 3] = perpendicular_y as f32;
    output[offset + 4] = distance as f32;
    *write_index += SPIRAL_SAMPLE_FLOATS;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(output: &[f32], index: usize) -> &[f32] {
        let start = index * SPIRAL_SAMPLE_FLOATS;
        &output[start..start + SPIRAL_SAMPLE_FLOATS]
    }

    #[test]
    fn rejects_invalid_segment_lengths() {
        let mut output = Vec::new();
        for length in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                write_spiral_segment_samples(
                    0.0,
                    0.0,
                    1.0,
                    0.0,
                    length,
                    0.0,
                    0.0,
                    false,
                    true,
                    0.0,
                    &mut output,
                ),
                Err(SpiralTrailError::InvalidSegmentLength)
            );
        }
    }

    #[test]
    fn straight_segment_includes_start_and_two_samples_per_tile() {
        let mut output = Vec::new();
        let count = write_spiral_segment_samples(
            0.0,
            0.0,
            3.0,
            4.0,
            5.0,
            0.0,
            0.0,
            false,
            true,
            0.0,
            &mut output,
        )
        .unwrap();

        assert_eq!(count, 11);
        assert_eq!(output.len(), count * SPIRAL_SAMPLE_FLOATS);
        let first = sample(&output, 0);
        assert_eq!(first[0], 0.0);
        assert_eq!(first[1], 0.0);
        assert!((first[2] + 0.8).abs() < 1e-6);
        assert!((first[3] - 0.6).abs() < 1e-6);
        assert_eq!(first[4], 0.0);

        let last = sample(&output, count - 1);
        assert_eq!(last[0], 3.0);
        assert_eq!(last[1], 4.0);
        assert!((last[2] + 0.8).abs() < 1e-6);
        assert!((last[3] - 0.6).abs() < 1e-6);
        assert_eq!(last[4], 5.0);
    }

    #[test]
    fn continued_segment_omits_start_and_offsets_distance() {
        let mut output = Vec::new();
        let count = write_spiral_segment_samples(
            10.0,
            20.0,
            12.0,
            20.0,
            2.0,
            1.0,
            0.0,
            true,
            false,
            7.5,
            &mut output,
        )
        .unwrap();

        assert_eq!(count, 4);
        assert_eq!(sample(&output, 0)[4], 8.0);
        assert_eq!(sample(&output, count - 1)[4], 9.5);
    }

    #[test]
    fn blends_previous_direction_into_new_segment() {
        let mut output = Vec::new();
        let count = write_spiral_segment_samples(
            0.0,
            0.0,
            0.0,
            2.0,
            2.0,
            1.0,
            0.0,
            true,
            false,
            4.0,
            &mut output,
        )
        .unwrap();

        assert_eq!(count, 4);
        let first = sample(&output, 0);
        assert!(first[2] < 0.0);
        assert!(first[3] > 0.0);
        let last = sample(&output, count - 1);
        assert!((last[2] + 1.0).abs() < 1e-6);
        assert!(last[3].abs() < 1e-6);
    }

    #[test]
    fn opposite_direction_midpoint_uses_new_direction_fallback() {
        let mut output = Vec::new();
        let count = write_spiral_segment_samples(
            2.0,
            0.0,
            0.0,
            0.0,
            2.0,
            1.0,
            0.0,
            true,
            false,
            2.0,
            &mut output,
        )
        .unwrap();

        assert_eq!(count, 4);
        let midpoint = sample(&output, 1);
        assert!(midpoint[2].abs() < 1e-6);
        assert!((midpoint[3] + 1.0).abs() < 1e-6);
    }
}
