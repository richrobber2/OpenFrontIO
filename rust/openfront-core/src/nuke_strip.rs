use crate::NukeControlPoints;

pub const NUKE_STRIP_FLOATS_PER_PAIR: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NukeStripError {
    ZeroSegments,
    SizeOverflow,
}

pub fn write_nuke_strip_vertices(
    control_points: NukeControlPoints,
    segments: usize,
    output: &mut Vec<f32>,
) -> Result<(), NukeStripError> {
    if segments == 0 {
        return Err(NukeStripError::ZeroSegments);
    }

    let float_count = segments
        .checked_add(1)
        .and_then(|pairs| pairs.checked_mul(NUKE_STRIP_FLOATS_PER_PAIR))
        .ok_or(NukeStripError::SizeOverflow)?;
    output.clear();
    output.resize(float_count, 0.0);

    let mut cumulative_distance = 0.0;
    let mut previous_x = control_points.p0x;
    let mut previous_y = control_points.p0y;
    let segment_count = segments as f64;

    for index in 0..=segments {
        let t = index as f64 / segment_count;
        let inverse_t = 1.0 - t;
        let inverse_t_sq = inverse_t * inverse_t;
        let t_sq = t * t;
        let x = inverse_t_sq * inverse_t * control_points.p0x
            + 3.0 * inverse_t_sq * t * control_points.p1x
            + 3.0 * inverse_t * t_sq * control_points.p2x
            + t_sq * t * control_points.p3x;
        let y = inverse_t_sq * inverse_t * control_points.p0y
            + 3.0 * inverse_t_sq * t * control_points.p1y
            + 3.0 * inverse_t * t_sq * control_points.p2y
            + t_sq * t * control_points.p3y;

        if index > 0 {
            let dx = x - previous_x;
            let dy = y - previous_y;
            cumulative_distance += (dx * dx + dy * dy).sqrt();
        }
        previous_x = x;
        previous_y = y;

        let offset = index * NUKE_STRIP_FLOATS_PER_PAIR;
        output[offset] = t as f32;
        output[offset + 1] = -1.0;
        output[offset + 2] = cumulative_distance as f32;
        output[offset + 3] = t as f32;
        output[offset + 4] = 1.0;
        output[offset + 5] = cumulative_distance as f32;
    }

    Ok(())
}

pub fn build_nuke_strip_vertices(
    control_points: NukeControlPoints,
    segments: usize,
) -> Result<Vec<f32>, NukeStripError> {
    let mut output = Vec::new();
    write_nuke_strip_vertices(control_points, segments, &mut output)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_control_points() -> NukeControlPoints {
        NukeControlPoints {
            p0x: 0.0,
            p0y: 25.0,
            p1x: 100.0 / 3.0,
            p1y: 25.0,
            p2x: 200.0 / 3.0,
            p2y: 25.0,
            p3x: 100.0,
            p3y: 25.0,
        }
    }

    #[test]
    fn rejects_zero_segments() {
        assert_eq!(
            build_nuke_strip_vertices(line_control_points(), 0),
            Err(NukeStripError::ZeroSegments)
        );
    }

    #[test]
    fn emits_two_vertices_per_sample() {
        let vertices = build_nuke_strip_vertices(line_control_points(), 4).unwrap();
        assert_eq!(vertices.len(), 5 * NUKE_STRIP_FLOATS_PER_PAIR);
        assert_eq!(&vertices[0..6], &[0.0, -1.0, 0.0, 0.0, 1.0, 0.0]);
        assert_eq!(vertices[24], 1.0);
        assert_eq!(vertices[25], -1.0);
        assert_eq!(vertices[27], 1.0);
        assert_eq!(vertices[28], 1.0);
    }

    #[test]
    fn cumulative_distance_matches_a_straight_bezier() {
        let vertices = build_nuke_strip_vertices(line_control_points(), 4).unwrap();
        let expected = [0.0, 25.0, 50.0, 75.0, 100.0];
        for (index, expected_distance) in expected.into_iter().enumerate() {
            let offset = index * NUKE_STRIP_FLOATS_PER_PAIR;
            assert!((vertices[offset + 2] - expected_distance).abs() < 0.0001);
            assert_eq!(vertices[offset + 2], vertices[offset + 5]);
        }
    }

    #[test]
    fn cumulative_distance_never_moves_backwards() {
        let control_points = NukeControlPoints {
            p0x: 10.0,
            p0y: 100.0,
            p1x: 85.0,
            p1y: 0.0,
            p2x: 235.0,
            p2y: 0.0,
            p3x: 310.0,
            p3y: 100.0,
        };
        let vertices = build_nuke_strip_vertices(control_points, 128).unwrap();
        let mut previous = 0.0;
        for sample in 0..=128 {
            let distance = vertices[sample * NUKE_STRIP_FLOATS_PER_PAIR + 2];
            assert!(distance >= previous);
            previous = distance;
        }
        assert!(previous > 300.0);
    }
}
